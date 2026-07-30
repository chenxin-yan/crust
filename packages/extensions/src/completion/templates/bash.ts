import { bashDoubleQuoteInner, bashSingleQuote } from "../escape.ts";
import type { CompletionArg, CompletionCommand, CompletionFlag, CompletionSpec } from "../spec.ts";

/**
 * Pure-static bash completion script renderer.
 *
 * Strategy: at generation time we walk the command tree and emit a
 * self-contained bash function that performs the full completion logic
 * locally — no `__complete` subprocess shell-out, no runtime callbacks.
 *
 * The generated script:
 *
 * 1. Defines a Cobra-style fallback init shim
 *    (`__<bin>_init_completion`) so the script works even when the
 *    `bash-completion` package is not installed (macOS default bash,
 *    Alpine, NixOS without the package).
 * 2. Walks `COMP_WORDS` left-to-right, advancing a `cmd_path` through
 *    the static command tree. Stops walking at the `--` end-of-options
 *    terminator and skips value-taking flag pairs so we don't mistake a
 *    flag value for a subcommand.
 * 3. Once the path is resolved, picks completion candidates:
 *    - if the user is mid-`--name=value`, splits on `=` and offers the
 *      static value list (or files) for that flag,
 *    - else if the previous token is a known flag-with-choices, offers
 *      the static value list,
 *    - else if the previous token is a known free-form value flag,
 *      falls back to file completion,
 *    - else if the current token starts with `-`, offers the flag set,
 *    - else offers the subcommand list and the resolved command's
 *      positional choices (or files for free-form positionals).
 * 4. Registers via `complete -F _<bin> <bin>` with the bin name passed
 *    through {@link bashSingleQuote}.
 */

/**
 * Convert a (validated) command name into a bash identifier. Bash
 * function names cannot contain `-` or `.`; we map the validated
 * identifier set down to `[A-Za-z0-9_]` so generated function names are
 * always valid even when names contain `-` or `.`.
 */
function toShellIdent(name: string): string {
	return name.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Render the wordlist of subcommand candidates for a single command —
 * each candidate as a bash-quoted shell word so values containing
 * spaces (theoretical: identifier validation rejects them) or shell
 * metacharacters (theoretical: same) survive `compgen -W` splitting.
 *
 * Includes canonical names and any declared aliases.
 */
function subcmdWordlist(node: CompletionCommand): string {
	// Names are validated identifiers (`assertSafeIdentifier`), so a
	// space-joined bare list is safe to embed in `compgen -W` and in
	// `for x in $list` loops — both do bash word-splitting that
	// doesn't strip quotes from already-quoted tokens.
	const words: string[] = [];
	for (const sub of node.subCommands) {
		words.push(sub.name);
		if (sub.aliases !== undefined) {
			for (const alias of sub.aliases) words.push(alias);
		}
	}
	return words.join(" ");
}

/**
 * Render the wordlist of flag candidates for a single command. Includes
 * long names, short alias, extra long aliases, and `--no-<name>` for
 * boolean flags that haven't opted out via `noNegate`.
 */
function flagWordlist(node: CompletionCommand): string {
	const words: string[] = [];
	for (const flag of node.flags) {
		words.push(`--${flag.name}`);
		if (flag.short !== undefined) words.push(`-${flag.short}`);
		if (flag.aliases !== undefined) {
			for (const alias of flag.aliases) words.push(`--${alias}`);
		}
		// `--no-<name>` for boolean toggles. Mirrors the parser's
		// negation-acceptance contract (core/parser.ts) so users can tab
		// to either spelling. Boolean multi-flags also support negation.
		if (flag.type === "boolean" && flag.noNegate !== true) {
			words.push(`--no-${flag.name}`);
			if (flag.aliases !== undefined) {
				for (const alias of flag.aliases) words.push(`--no-${alias}`);
			}
		}
	}
	return words.join(" ");
}

interface BashCase {
	/**
	 * `<parent-path>|<word>` — empty parent path is `""`, child paths use
	 * `:` as a separator (e.g. `"deploy:prod"`).
	 */
	key: string;
	/** New `cmd_path` to set when this branch matches. */
	cmdPath: string;
	/** Subcommand wordlist for the new path. */
	subcmds: string;
	/** Flag wordlist for the new path. */
	flags: string;
	/** Space-separated list of flag spellings that take a value at this depth. */
	valueFlags: string;
}

/**
 * Recursively collect every (parent-path, child-word) edge in the command
 * tree as a `case` branch the dispatch loop can consume. Aliases are
 * surfaced as additional `case` keys that resolve to the same `cmd_path`,
 * matching the router's alias-aware behaviour.
 */
function collectPathCases(parentPath: string, parent: CompletionCommand, out: BashCase[]): void {
	for (const sub of parent.subCommands) {
		const newPath = parentPath === "" ? sub.name : `${parentPath}:${sub.name}`;
		const subcmds = subcmdWordlist(sub);
		const flags = flagWordlist(sub);
		const valueFlags = valueFlagWordlist(sub);

		// Canonical name edge.
		out.push({
			key: `${parentPath}|${sub.name}`,
			cmdPath: newPath,
			subcmds,
			flags,
			valueFlags,
		});

		// Alias edges resolve to the same cmd_path so children of the
		// canonical node are reachable via either spelling.
		if (sub.aliases !== undefined) {
			for (const alias of sub.aliases) {
				out.push({
					key: `${parentPath}|${alias}`,
					cmdPath: newPath,
					subcmds,
					flags,
					valueFlags,
				});
			}
		}

		collectPathCases(newPath, sub, out);
	}
}

interface ChoiceCase {
	/** `<cmd_path>|<flag-spelling>` (long, short, or alias). */
	key: string;
	/** Bash-quoted, space-joined value list. */
	values: string;
}

/**
 * One entry per value-flag that needs explicit value-completion handling.
 *
 * - `kind: "path"`     — emit `compgen -f` candidates for the value token.
 * - `kind: "suppress"` — disable the `complete -o default` file fallback
 *                       so url/json flags don't get filenames offered.
 */
interface ValueTypeCase {
	/** `<cmd_path>|<flag-spelling>` (long, short, or alias). */
	key: string;
	kind: "path" | "suppress";
}

/**
 * Walk every flag at every depth and emit one {@link ValueTypeCase} per
 * spelling for flags that declared `type: "path"` (file completion) or
 * `type: "url" | "json"` (suppress file fallback).
 */
function collectValueTypeCases(
	cmdPath: string,
	node: CompletionCommand,
	out: ValueTypeCase[],
): void {
	for (const flag of node.flags) {
		if (flag.valueCompletion === undefined) continue;
		const kind: ValueTypeCase["kind"] = flag.valueCompletion === "files" ? "path" : "suppress";
		for (const spelling of flagSpellings(flag)) {
			out.push({ key: `${cmdPath}|${spelling}`, kind });
		}
	}
	for (const sub of node.subCommands) {
		const subPath = cmdPath === "" ? sub.name : `${cmdPath}:${sub.name}`;
		collectValueTypeCases(subPath, sub, out);
	}
}

/**
 * For every flag at every command depth that declares `choices`, emit a
 * `case` branch mapping `<path>|<flag-spelling>` → values. Each spelling
 * (long, short, alias) gets its own branch so the lookup is constant-time
 * regardless of how the user wrote the flag.
 */
function collectChoiceCases(cmdPath: string, node: CompletionCommand, out: ChoiceCase[]): void {
	for (const flag of node.flags) {
		if (flag.choices === undefined) continue;
		// Choice values are validated to a safe character set, so we can
		// emit them bare inside the `compgen -W` wordlist without per-
		// candidate quoting. This keeps the generated script readable.
		const values = flag.choices.join(" ");
		const spellings = flagSpellings(flag);
		for (const spelling of spellings) {
			out.push({ key: `${cmdPath}|${spelling}`, values });
		}
	}
	for (const sub of node.subCommands) {
		const subPath = cmdPath === "" ? sub.name : `${cmdPath}:${sub.name}`;
		collectChoiceCases(subPath, sub, out);
	}
}

/**
 * Per-command summary of positional-argument choices. Built once per
 * command and consumed by the runtime walker to map a `(cmd_path,
 * pos_idx)` pair to a candidate list.
 *
 * `bySlot` lists *fixed-slot* arguments with choices, in declaration
 * order. `variadicFrom` is set when the command ends in a variadic
 * positional that has choices — the choice list then applies to every
 * slot from `variadicFrom` onwards.
 */
interface ArgChoiceEntry {
	/** Command path key (e.g. `""`, `"build"`, `"remote:add"`). */
	cmdPath: string;
	/**
	 * Fixed-slot positional choices. Index N's choice list is at `bySlot[N]`
	 * when defined; gaps (no choices) are `undefined`. The array length is
	 * the number of declared *non-variadic* positionals.
	 */
	bySlot: ReadonlyArray<string | undefined>;
	/** Slot index from which `variadicValues` applies, or `undefined`. */
	variadicFrom?: number;
	/** Bash-quoted, space-joined value list for the variadic tail. */
	variadicValues?: string;
}

/**
 * Per-command summary of positional-argument slots that must suppress
 * the global `complete -o default` file fallback (url/json positionals
 * are not filesystem paths). Mirrors {@link ArgChoiceEntry}'s shape so
 * the renderer can iterate it the same way.
 */
interface ArgSuppressEntry {
	cmdPath: string;
	/** Fixed-slot suppression indices. */
	slots: ReadonlyArray<number>;
	/** Slot index from which variadic suppression applies, or `undefined`. */
	variadicFrom?: number;
}

/**
 * Collect per-command positional suppression entries. Each url/json
 * positional contributes one slot index; a variadic url/json positional
 * also sets `variadicFrom` so suppression extends past the declared slot.
 */
function collectArgSuppressCases(
	cmdPath: string,
	node: CompletionCommand,
	out: ArgSuppressEntry[],
): void {
	const slots: number[] = [];
	let variadicFrom: number | undefined;
	node.args.forEach((arg: CompletionArg, idx: number) => {
		if (arg.valueCompletion !== "none") return;
		if (arg.variadic) {
			variadicFrom = idx;
		} else {
			slots.push(idx);
		}
	});
	if (slots.length > 0 || variadicFrom !== undefined) {
		out.push({ cmdPath, slots, variadicFrom });
	}
	for (const sub of node.subCommands) {
		const subPath = cmdPath === "" ? sub.name : `${cmdPath}:${sub.name}`;
		collectArgSuppressCases(subPath, sub, out);
	}
}

/**
 * Collect per-command positional choice entries, recursively. Returns
 * one {@link ArgChoiceEntry} per command that has at least one positional
 * arg with a `choices` list (variadic or otherwise). Commands with no
 * positional choices are omitted so the rendered case-block stays
 * tight.
 */
function collectArgChoiceCases(
	cmdPath: string,
	node: CompletionCommand,
	out: ArgChoiceEntry[],
): void {
	const bySlot: Array<string | undefined> = [];
	let variadicFrom: number | undefined;
	let variadicValues: string | undefined;
	let hasAny = false;
	node.args.forEach((arg: CompletionArg, idx: number) => {
		if (arg.variadic) {
			if (arg.choices !== undefined) {
				variadicFrom = idx;
				// Validated bare values — see comment in `collectChoiceCases`.
				variadicValues = arg.choices.join(" ");
				hasAny = true;
			}
			return;
		}
		if (arg.choices !== undefined) {
			bySlot[idx] = arg.choices.join(" ");
			hasAny = true;
		} else {
			bySlot[idx] = undefined;
		}
	});
	if (hasAny) {
		out.push({ cmdPath, bySlot, variadicFrom, variadicValues });
	}
	for (const sub of node.subCommands) {
		const subPath = cmdPath === "" ? sub.name : `${cmdPath}:${sub.name}`;
		collectArgChoiceCases(subPath, sub, out);
	}
}

function flagSpellings(flag: CompletionFlag): string[] {
	const out: string[] = [`--${flag.name}`];
	if (flag.short !== undefined) out.push(`-${flag.short}`);
	if (flag.aliases !== undefined) {
		for (const alias of flag.aliases) out.push(`--${alias}`);
	}
	return out;
}

/**
 * Render the wordlist of *value-taking* flag spellings for a single
 * command. Used to drive both flag-value context (after `--target`) and
 * the path walker's "skip the next token" heuristic.
 */
function valueFlagWordlist(node: CompletionCommand): string {
	const words: string[] = [];
	for (const flag of node.flags) {
		if (!flag.takesValue) continue;
		for (const spelling of flagSpellings(flag)) words.push(spelling);
	}
	return words.join(" ");
}

/**
 * Render a self-contained bash completion script for the given spec.
 *
 * @param spec     The walker output describing the command tree.
 * @param binName  The user-facing binary name. Validated via
 *                 {@link assertSafeBinName} upstream.
 * @param version  Free-form version string for the header comment;
 *                 control characters are stripped before emission.
 */
export function renderBash(spec: CompletionSpec, binName: string, version: string): string {
	const ident = toShellIdent(binName);
	const fnName = `_${ident}`;
	const initFn = `__${ident}_init_completion`;

	const rootSubcmds = subcmdWordlist(spec.root);
	const rootFlags = flagWordlist(spec.root);
	const rootValueFlags = valueFlagWordlist(spec.root);

	const pathCases: BashCase[] = [];
	collectPathCases("", spec.root, pathCases);

	const choiceCases: ChoiceCase[] = [];
	collectChoiceCases("", spec.root, choiceCases);

	const valueTypeCases: ValueTypeCase[] = [];
	collectValueTypeCases("", spec.root, valueTypeCases);

	const argChoiceEntries: ArgChoiceEntry[] = [];
	collectArgChoiceCases("", spec.root, argChoiceEntries);

	const argSuppressEntries: ArgSuppressEntry[] = [];
	collectArgSuppressCases("", spec.root, argSuppressEntries);

	const lines: string[] = [];

	lines.push(
		`# completion script for ${binName} v${version} — regenerate with: ${binName} completion bash`,
	);
	lines.push("");

	// Cobra-style init shim. Provides cur/prev/words/cword without depending
	// on the bash-completion package. Reference: spf13/cobra
	// bash_completionsV2.go lines 48–54.
	lines.push(`${initFn}() {`);
	lines.push("\tCOMPREPLY=()");
	// oxlint-disable-next-line no-template-curly-in-string -- bash variable expansion
	lines.push('\tcur="${COMP_WORDS[COMP_CWORD]}"');
	lines.push(
		// oxlint-disable-next-line no-template-curly-in-string -- bash variable expansion
		'\tif (( COMP_CWORD > 0 )); then prev="${COMP_WORDS[COMP_CWORD-1]}"; else prev=""; fi',
	);
	// oxlint-disable-next-line no-template-curly-in-string -- bash variable expansion
	lines.push('\twords=("${COMP_WORDS[@]}")');
	lines.push("\tcword=$COMP_CWORD");
	lines.push("}");
	lines.push("");

	// Helper: test whether the previous token is a value-taking flag at
	// the current depth. Returns 0 (true) when prev is in $valueFlags,
	// 1 otherwise.
	lines.push(`__${ident}_prev_is_value_flag() {`);
	lines.push("\tlocal candidate");
	lines.push("\tfor candidate in $valueFlags; do");
	lines.push('\t\tif [[ "$candidate" == "$prev" ]]; then return 0; fi');
	lines.push("\tdone");
	lines.push("\treturn 1");
	lines.push("}");
	lines.push("");

	// Main completion function.
	lines.push(`${fnName}() {`);
	lines.push("\tlocal cur prev words cword");
	lines.push("\tif declare -F _init_completion >/dev/null 2>&1; then");
	lines.push('\t\t_init_completion -n "=" || return');
	lines.push("\telse");
	lines.push(`\t\t${initFn} || return`);
	lines.push("\tfi");
	lines.push("");
	lines.push('\tlocal cmd_path=""');
	lines.push(`\tlocal subcmds="${bashDoubleQuoteInner(rootSubcmds)}"`);
	lines.push(`\tlocal flags="${bashDoubleQuoteInner(rootFlags)}"`);
	lines.push(`\tlocal valueFlags="${bashDoubleQuoteInner(rootValueFlags)}"`);
	lines.push("\tlocal i=1");
	lines.push("\tlocal end_of_options=0");
	lines.push("");
	lines.push("\twhile (( i < cword )); do");
	// oxlint-disable-next-line no-template-curly-in-string -- bash variable expansion
	lines.push('\t\tlocal w="${words[$i]}"');
	// `--` terminator: stop subcommand routing for the rest of the line.
	lines.push('\t\tif [[ "$w" == "--" ]]; then');
	lines.push("\t\t\tend_of_options=1");
	lines.push("\t\t\t((i++)); break");
	lines.push("\t\tfi");
	// `--name=value` form: the equals sign is part of one token, so we
	// don't need to skip a following value token.
	lines.push('\t\tif [[ "$w" == --*=* ]]; then');
	lines.push("\t\t\t((i++)); continue");
	lines.push("\t\tfi");
	// Bare flag: if it's a value-taking flag, skip the value too.
	lines.push('\t\tif [[ "$w" == -* ]]; then');
	lines.push("\t\t\tlocal candidate");
	lines.push("\t\t\tlocal _was_value_flag=0");
	lines.push("\t\t\tfor candidate in $valueFlags; do");
	lines.push('\t\t\t\tif [[ "$candidate" == "$w" ]]; then _was_value_flag=1; break; fi');
	lines.push("\t\t\tdone");
	lines.push("\t\t\tif (( _was_value_flag )); then ((i+=2)); else ((i++)); fi");
	lines.push("\t\t\tcontinue");
	lines.push("\t\tfi");
	lines.push('\t\tcase "$cmd_path|$w" in');
	for (const c of pathCases) {
		lines.push(`\t\t\t"${bashDoubleQuoteInner(c.key)}")`);
		lines.push(`\t\t\t\tcmd_path="${bashDoubleQuoteInner(c.cmdPath)}"`);
		lines.push(`\t\t\t\tsubcmds="${bashDoubleQuoteInner(c.subcmds)}"`);
		lines.push(`\t\t\t\tflags="${bashDoubleQuoteInner(c.flags)}"`);
		lines.push(`\t\t\t\tvalueFlags="${bashDoubleQuoteInner(c.valueFlags)}"`);
		lines.push("\t\t\t\t;;");
	}
	lines.push("\t\t\t*) break ;;");
	lines.push("\t\tesac");
	lines.push("\t\t((i++))");
	lines.push("\tdone");
	lines.push("");

	// After `--`: stop offering subcommands/flags entirely; bash falls
	// through to file completion via `complete -o default`.
	lines.push("\tif (( end_of_options )); then");
	lines.push("\t\treturn");
	lines.push("\tfi");
	lines.push("");

	// `--name=value` partial: split, look up, offer either choice values
	// or fall through to default (file) completion.
	lines.push('\tif [[ "$cur" == --*=* ]]; then');
	// oxlint-disable-next-line no-template-curly-in-string -- bash variable expansion
	lines.push('\t\tlocal _flag="${cur%%=*}"');
	// oxlint-disable-next-line no-template-curly-in-string -- bash variable expansion
	lines.push('\t\tlocal _value="${cur#*=}"');
	if (choiceCases.length > 0) {
		// `compgen -P` prefixes every candidate with `${_flag}=` so bash's
		// command-line replacement substitutes the full token (otherwise
		// readline would replace `--target=br` with bare `browser`).
		lines.push('\t\tcase "$cmd_path|$_flag" in');
		for (const c of choiceCases) {
			lines.push(`\t\t\t"${bashDoubleQuoteInner(c.key)}")`);
			lines.push(
				`\t\t\t\tCOMPREPLY=( $(compgen -P "\${_flag}=" -W "${bashDoubleQuoteInner(c.values)}" -- "$_value") )`,
			);
			lines.push("\t\t\t\treturn");
			lines.push("\t\t\t\t;;");
		}
		lines.push("\t\tesac");
	}
	// `--name=value` for typed value flags: emit explicit path candidates
	// (path) or suppress the `complete -o default` file fallback (url/json).
	if (valueTypeCases.length > 0) {
		lines.push('\t\tcase "$cmd_path|$_flag" in');
		for (const c of valueTypeCases) {
			lines.push(`\t\t\t"${bashDoubleQuoteInner(c.key)}")`);
			if (c.kind === "path") {
				lines.push(
					// oxlint-disable-next-line no-template-curly-in-string -- bash variable expansion
					'\t\t\t\tCOMPREPLY=( $(compgen -P "${_flag}=" -f -- "$_value") )',
				);
			} else {
				lines.push("\t\t\t\tcompopt +o default 2>/dev/null");
			}
			lines.push("\t\t\t\treturn");
			lines.push("\t\t\t\t;;");
		}
		lines.push("\t\tesac");
	}
	// Free-form `--name=value`: let bash file-complete the value portion.
	lines.push("\t\treturn");
	lines.push("\tfi");
	lines.push("");

	// Flag-with-choices: if previous word matches, offer the value list.
	if (choiceCases.length > 0) {
		lines.push('\tcase "$cmd_path|$prev" in');
		for (const c of choiceCases) {
			lines.push(`\t\t"${bashDoubleQuoteInner(c.key)}")`);
			lines.push(`\t\t\tCOMPREPLY=( $(compgen -W "${bashDoubleQuoteInner(c.values)}" -- "$cur") )`);
			lines.push("\t\t\treturn");
			lines.push("\t\t\t;;");
		}
		lines.push("\tesac");
		lines.push("");
	}

	// Typed value-flag context: previous token is a path/url/json flag.
	// Path → emit explicit file candidates; url/json → suppress the
	// `complete -o default` fallback so we don't offer filenames.
	if (valueTypeCases.length > 0) {
		lines.push('\tcase "$cmd_path|$prev" in');
		for (const c of valueTypeCases) {
			lines.push(`\t\t"${bashDoubleQuoteInner(c.key)}")`);
			if (c.kind === "path") {
				lines.push('\t\t\tCOMPREPLY=( $(compgen -f -- "$cur") )');
			} else {
				lines.push("\t\t\tcompopt +o default 2>/dev/null");
			}
			lines.push("\t\t\treturn");
			lines.push("\t\t\t;;");
		}
		lines.push("\tesac");
		lines.push("");
	}

	// Free-form value flag context: previous token is a known
	// value-taking flag with no choices and no typed override → fall
	// through to file completion via `complete -o default`.
	lines.push(`\tif __${ident}_prev_is_value_flag; then`);
	lines.push("\t\treturn");
	lines.push("\tfi");
	lines.push("");

	// Default branch: flags vs subcmds vs positional choices.
	lines.push('\tif [[ "$cur" == -* ]]; then');
	lines.push('\t\tCOMPREPLY=( $(compgen -W "$flags" -- "$cur") )');
	lines.push("\telse");
	const needsPosWalk = argChoiceEntries.length > 0 || argSuppressEntries.length > 0;
	if (needsPosWalk) {
		// Count completed positional tokens between the resolved command
		// path and the cursor. Token classes we *skip*:
		//  - `--`                  (end-of-options terminator)
		//  - `--name=value`        (single token, value is inlined)
		//  - bare flags `-*`       (and the next token if the flag takes a value)
		// What remains is positional values. `pos_idx` is the slot the
		// cursor is currently filling (0 for the first positional slot).
		lines.push("\t\tlocal pos_idx=0");
		lines.push("\t\tlocal _pidx_j=$i");
		lines.push("\t\tlocal _pidx_skip_next=0");
		lines.push("\t\twhile (( _pidx_j < cword )); do");
		// oxlint-disable-next-line no-template-curly-in-string -- bash variable expansion
		lines.push('\t\t\tlocal _pidx_w="${words[$_pidx_j]}"');
		lines.push("\t\t\tif (( _pidx_skip_next )); then");
		lines.push("\t\t\t\t_pidx_skip_next=0");
		lines.push("\t\t\t\t((_pidx_j++)); continue");
		lines.push("\t\t\tfi");
		lines.push('\t\t\tif [[ "$_pidx_w" == "--" ]]; then');
		lines.push("\t\t\t\t((_pidx_j++)); continue");
		lines.push("\t\t\tfi");
		lines.push('\t\t\tif [[ "$_pidx_w" == --*=* ]]; then');
		lines.push("\t\t\t\t((_pidx_j++)); continue");
		lines.push("\t\t\tfi");
		lines.push('\t\t\tif [[ "$_pidx_w" == -* ]]; then');
		lines.push("\t\t\t\tlocal _pidx_cand");
		lines.push("\t\t\t\tfor _pidx_cand in $valueFlags; do");
		lines.push('\t\t\t\t\tif [[ "$_pidx_cand" == "$_pidx_w" ]]; then _pidx_skip_next=1; break; fi');
		lines.push("\t\t\t\tdone");
		lines.push("\t\t\t\t((_pidx_j++)); continue");
		lines.push("\t\t\tfi");
		// Use `pos_idx=$((pos_idx + 1))` rather than `((pos_idx++))` so the
		// statement's exit code is always 0. Bash treats `((expr))` as
		// false when `expr` evaluates to 0, and `((pos_idx++))` evaluates
		// to the *old* value of `pos_idx` — incrementing from 0 to 1
		// would return exit code 1, which kills consumers that source
		// the script under `set -e`.
		lines.push("\t\t\tpos_idx=$((pos_idx + 1))");
		lines.push("\t\t\t((_pidx_j++))");
		lines.push("\t\tdone");
		lines.push('\t\tlocal pos_choices=""');
		// Per-command, nested per-slot case. The slot ladder includes a
		// `*)` fallback for variadic-with-choices commands so every slot
		// from `variadicFrom` onwards offers the variadic candidate set.
		lines.push('\t\tcase "$cmd_path" in');
		for (const entry of argChoiceEntries) {
			lines.push(`\t\t\t"${bashDoubleQuoteInner(entry.cmdPath)}")`);
			lines.push('\t\t\t\tcase "$pos_idx" in');
			entry.bySlot.forEach((values, idx) => {
				if (values === undefined) return;
				lines.push(`\t\t\t\t\t${idx})`);
				lines.push(`\t\t\t\t\t\tpos_choices="${bashDoubleQuoteInner(values)}"`);
				lines.push("\t\t\t\t\t\t;;");
			});
			if (entry.variadicFrom !== undefined && entry.variadicValues !== undefined) {
				lines.push("\t\t\t\t\t*)");
				lines.push(
					`\t\t\t\t\t\tif (( pos_idx >= ${entry.variadicFrom} )); then pos_choices="${bashDoubleQuoteInner(entry.variadicValues)}"; fi`,
				);
				lines.push("\t\t\t\t\t\t;;");
			}
			lines.push("\t\t\t\tesac");
			lines.push("\t\t\t\t;;");
		}
		lines.push("\t\tesac");

		// url/json positional slots: disable the `complete -o default` file
		// fallback so users aren't offered filenames for non-path values.
		// Path positionals are *not* listed here.
		if (argSuppressEntries.length > 0) {
			lines.push('\t\tcase "$cmd_path" in');
			for (const entry of argSuppressEntries) {
				lines.push(`\t\t\t"${bashDoubleQuoteInner(entry.cmdPath)}")`);
				lines.push('\t\t\t\tcase "$pos_idx" in');
				for (const slot of entry.slots) {
					lines.push(`\t\t\t\t\t${slot})`);
					lines.push("\t\t\t\t\t\tcompopt +o default 2>/dev/null");
					lines.push("\t\t\t\t\t\t;;");
				}
				if (entry.variadicFrom !== undefined) {
					lines.push("\t\t\t\t\t*)");
					lines.push(
						`\t\t\t\t\t\tif (( pos_idx >= ${entry.variadicFrom} )); then compopt +o default 2>/dev/null; fi`,
					);
					lines.push("\t\t\t\t\t\t;;");
				}
				lines.push("\t\t\t\tesac");
				lines.push("\t\t\t\t;;");
			}
			lines.push("\t\tesac");
		}

		// At slot 0, blend positional choices with subcommand candidates so
		// commands that offer BOTH a positional choice list AND subcommands
		// surface both. At slot >0 we never offer subcommands.
		lines.push("\t\tif (( pos_idx == 0 )); then");
		lines.push('\t\t\tCOMPREPLY=( $(compgen -W "$pos_choices $subcmds" -- "$cur") )');
		lines.push("\t\telse");
		lines.push('\t\t\tCOMPREPLY=( $(compgen -W "$pos_choices" -- "$cur") )');
		lines.push("\t\tfi");
	} else {
		lines.push('\t\tCOMPREPLY=( $(compgen -W "$subcmds" -- "$cur") )');
	}
	lines.push("\tfi");
	lines.push("}");
	lines.push("");

	// Registration. `-o default` lets bash fall through to filename
	// completion when our wordlists return nothing — handy for free
	// positional args that take filesystem paths and for free-form
	// flag values after we `return` without setting COMPREPLY.
	lines.push(`complete -o default -F ${fnName} ${bashSingleQuote(binName)}`);

	return `${lines.join("\n")}\n`;
}
