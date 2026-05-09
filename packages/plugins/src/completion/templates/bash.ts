import type {
	CompletionCommand,
	CompletionFlag,
	CompletionSpec,
} from "../spec.ts";

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
 * 2. Walks `COMP_WORDS` left-to-right, skipping option words, and
 *    advances a `cmd_path` through the static command tree using a
 *    `case` dispatch keyed by `"<parent-path>|<word>"`.
 * 3. Once the path is resolved, picks completion candidates:
 *    - if the previous token is a known flag-with-choices, offers the
 *      static value list,
 *    - else if the current token starts with `-`, offers the flag set
 *      for the resolved command,
 *    - else offers the subcommand list (canonical names + aliases).
 * 4. Registers via `complete -F _<bin> <bin>`.
 */

/**
 * Convert an arbitrary command name into a bash identifier. Bash function
 * names cannot contain `-`; we map every non-`[A-Za-z0-9_]` to `_` so
 * generated function names are always valid.
 */
function toShellIdent(name: string): string {
	return name.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Quote a value for safe inclusion inside a double-quoted bash string.
 * We only inline command names, flag spellings, and choice values — none of
 * which can legitimately carry control characters — so this is a defensive
 * check rather than a sanitiser. We escape `"`, `\`, `$`, and backtick.
 */
function bashQuote(value: string): string {
	return value.replace(/[\\$`"]/g, "\\$&");
}

/**
 * Render the space-separated wordlist of subcommand candidates for a
 * single command. Includes canonical names and any declared aliases so
 * users can tab-complete either spelling.
 */
function subcmdWordlist(node: CompletionCommand): string {
	const words: string[] = [];
	for (const sub of node.subCommands) {
		words.push(sub.name);
		if (sub.aliases !== undefined) {
			for (const alias of sub.aliases) words.push(alias);
		}
	}
	return words.map(bashQuote).join(" ");
}

/**
 * Render the space-separated wordlist of flag candidates for a single
 * command. Includes long names, short alias (with single-dash prefix), and
 * any extra long aliases. Boolean flags with `noNegate !== true` are not
 * specially marked here — we leave `--no-foo` out of completion candidates
 * by default to keep menus tight (users who know the negation form will
 * type it manually). The visible set is what `effectiveFlags` exposes.
 */
function flagWordlist(node: CompletionCommand): string {
	const words: string[] = [];
	for (const flag of node.flags) {
		words.push(`--${flag.name}`);
		if (flag.short !== undefined) words.push(`-${flag.short}`);
		if (flag.aliases !== undefined) {
			for (const alias of flag.aliases) words.push(`--${alias}`);
		}
	}
	return words.map(bashQuote).join(" ");
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
}

/**
 * Recursively collect every (parent-path, child-word) edge in the command
 * tree as a `case` branch the dispatch loop can consume. Aliases are
 * surfaced as additional `case` keys that resolve to the same `cmd_path`,
 * matching the router's alias-aware behaviour (TP-016).
 */
function collectPathCases(
	parentPath: string,
	parent: CompletionCommand,
	out: BashCase[],
): void {
	for (const sub of parent.subCommands) {
		const newPath = parentPath === "" ? sub.name : `${parentPath}:${sub.name}`;
		const subcmds = subcmdWordlist(sub);
		const flags = flagWordlist(sub);

		// Canonical name edge.
		out.push({
			key: `${parentPath}|${sub.name}`,
			cmdPath: newPath,
			subcmds,
			flags,
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
				});
			}
		}

		collectPathCases(newPath, sub, out);
	}
}

interface ChoiceCase {
	/** `<cmd_path>|<flag-spelling>` (long, short, or alias). */
	key: string;
	/** Space-separated value list. */
	values: string;
}

/**
 * For every flag at every command depth that declares `choices`, emit a
 * `case` branch mapping `<path>|<flag-spelling>` → values. Each spelling
 * (long, short, alias) gets its own branch so the lookup is constant-time
 * regardless of how the user wrote the flag.
 */
function collectChoiceCases(
	cmdPath: string,
	node: CompletionCommand,
	out: ChoiceCase[],
): void {
	for (const flag of node.flags) {
		if (flag.choices === undefined) continue;
		const values = flag.choices.map(bashQuote).join(" ");
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

function flagSpellings(flag: CompletionFlag): string[] {
	const out: string[] = [`--${flag.name}`];
	if (flag.short !== undefined) out.push(`-${flag.short}`);
	if (flag.aliases !== undefined) {
		for (const alias of flag.aliases) out.push(`--${alias}`);
	}
	return out;
}

/**
 * Render a self-contained bash completion script for the given spec.
 *
 * @param spec     The walker output describing the command tree.
 * @param binName  The user-facing binary name (the `complete -F` target).
 *                 Should be the name the user actually invokes — usually
 *                 the root `meta.name`. Special characters are tolerated
 *                 in the registration line; the helper function name is
 *                 derived via `toShellIdent` so it remains a valid bash
 *                 identifier.
 * @param version  Free-form version string for the header comment. We do
 *                 not parse it; the value flows through verbatim.
 */
export function renderBash(
	spec: CompletionSpec,
	binName: string,
	version: string,
): string {
	const ident = toShellIdent(binName);
	const fnName = `_${ident}`;
	const initFn = `__${ident}_init_completion`;

	const rootSubcmds = subcmdWordlist(spec.root);
	const rootFlags = flagWordlist(spec.root);

	const pathCases: BashCase[] = [];
	collectPathCases("", spec.root, pathCases);

	const choiceCases: ChoiceCase[] = [];
	collectChoiceCases("", spec.root, choiceCases);

	const lines: string[] = [];

	// Header — first line per task spec.
	lines.push(
		`# completion script for ${binName} v${version} — regenerate with: ${binName} completion bash`,
	);
	lines.push("");

	// Cobra-style init shim. Provides cur/prev/words/cword without depending
	// on the bash-completion package. Reference: spf13/cobra
	// bash_completionsV2.go lines 48–54.
	lines.push(`${initFn}() {`);
	lines.push("\tCOMPREPLY=()");
	// biome-ignore lint/suspicious/noTemplateCurlyInString: bash variable expansion
	lines.push('\tcur="${COMP_WORDS[COMP_CWORD]}"');
	lines.push(
		// biome-ignore lint/suspicious/noTemplateCurlyInString: bash variable expansion
		'\tif (( COMP_CWORD > 0 )); then prev="${COMP_WORDS[COMP_CWORD-1]}"; else prev=""; fi',
	);
	// biome-ignore lint/suspicious/noTemplateCurlyInString: bash variable expansion
	lines.push('\twords=("${COMP_WORDS[@]}")');
	lines.push("\tcword=$COMP_CWORD");
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
	lines.push("\tlocal i=1");
	lines.push(`\tlocal subcmds="${rootSubcmds}"`);
	lines.push(`\tlocal flags="${rootFlags}"`);
	lines.push("");
	lines.push("\twhile (( i < cword )); do");
	// biome-ignore lint/suspicious/noTemplateCurlyInString: bash variable expansion
	lines.push('\t\tlocal w="${words[$i]}"');
	lines.push('\t\tif [[ "$w" == -* ]]; then');
	lines.push("\t\t\t((i++)); continue");
	lines.push("\t\tfi");
	lines.push('\t\tcase "$cmd_path|$w" in');
	for (const c of pathCases) {
		lines.push(`\t\t\t"${bashQuote(c.key)}")`);
		lines.push(`\t\t\t\tcmd_path="${bashQuote(c.cmdPath)}"`);
		lines.push(`\t\t\t\tsubcmds="${c.subcmds}"`);
		lines.push(`\t\t\t\tflags="${c.flags}"`);
		lines.push("\t\t\t\t;;");
	}
	lines.push("\t\t\t*) break ;;");
	lines.push("\t\tesac");
	lines.push("\t\t((i++))");
	lines.push("\tdone");
	lines.push("");

	// Flag-with-choices: if previous word matches, offer the value list.
	if (choiceCases.length > 0) {
		lines.push('\tcase "$cmd_path|$prev" in');
		for (const c of choiceCases) {
			lines.push(`\t\t"${bashQuote(c.key)}")`);
			lines.push(`\t\t\tCOMPREPLY=( $(compgen -W "${c.values}" -- "$cur") )`);
			lines.push("\t\t\treturn");
			lines.push("\t\t\t;;");
		}
		lines.push("\tesac");
		lines.push("");
	}

	// Default branch: flags vs subcmds.
	lines.push('\tif [[ "$cur" == -* ]]; then');
	lines.push('\t\tCOMPREPLY=( $(compgen -W "$flags" -- "$cur") )');
	lines.push("\telse");
	lines.push('\t\tCOMPREPLY=( $(compgen -W "$subcmds" -- "$cur") )');
	lines.push("\tfi");
	lines.push("}");
	lines.push("");

	// Registration. `-o default` lets bash fall through to filename
	// completion when our wordlists return nothing — handy for free
	// positional args that take filesystem paths.
	lines.push(`complete -o default -F ${fnName} ${bashQuote(binName)}`);

	return `${lines.join("\n")}\n`;
}
