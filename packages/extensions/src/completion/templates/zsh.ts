import { zshArgsDescription, zshDescribeField, zshSingleQuote } from "../escape.ts";
import type { CompletionCommand, CompletionFlag } from "../spec.ts";

/**
 * Pure-static zsh completion script renderer.
 *
 * Strategy: emit one `_<bin>_<path>` helper per command in the tree.
 * Helpers for non-leaf commands declare an `_arguments -C` spec with
 * `1: :->cmds` and `*::arg:->args`, then dispatch via `case "$line[1]"`
 * into the child helper — the canonical `->state` routing pattern from
 * `man zshcompsys` (and used by oclif's `ZshCompWithSpaces`).
 *
 * The first line is `#compdef <bin>` (required by zsh's autoload mechanism)
 * and the entry-point function is invoked with `"$@"` at the end so the
 * script works both when dropped into `$fpath` and when sourced directly
 * (e.g. via `eval "$(mycli completion zsh)"`).
 *
 * **Quoting model.** Every spec string is wrapped via {@link zshSingleQuote}
 * so it survives any character (description text, choice values) by going
 * through the standard `'foo'\''bar'` close-and-reopen idiom. The spec
 * **contents** are independently escaped via {@link zshArgsDescription}
 * (for `_arguments` description brackets) and {@link zshDescribeField}
 * (for the colon-separated `_describe` items).
 */

function toShellIdent(name: string): string {
	return name.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Render the `_arguments` specs for every flag on a given command. Each
 * flag becomes one or more spec strings depending on whether it has a
 * short alias (we use the `(-x --name){-x,--name}` mutex+alias pattern).
 */
function renderFlagSpecs(node: CompletionCommand): string[] {
	const specs: string[] = [];
	for (const flag of node.flags) {
		specs.push(...flagSpecs(flag));
	}
	return specs;
}

function flagSpecs(flag: CompletionFlag): string[] {
	const desc = flag.description ?? "";
	const descPart = `[${zshArgsDescription(desc)}]`;

	// Build the value-action suffix once: empty for booleans, ` :NAME:`
	// (with `_files` for free-form strings) for value-takers.
	let valueSuffix = "";
	if (flag.takesValue) {
		const valueLabel = flag.name; // shown as the prompt placeholder
		if (flag.choices !== undefined && flag.choices.length > 0) {
			// Choice values are validated by `assertSafeChoiceValue` to
			// contain only `[A-Za-z0-9_.+:@/-]`, so they can be emitted bare
			// inside the `(…)` action list without further escaping.
			const opts = flag.choices.join(" ");
			valueSuffix = `:${valueLabel}:(${opts})`;
		} else if (flag.valueCompletion === "files") {
			// Explicit file completion for path flags.
			valueSuffix = `:${valueLabel}:_files`;
		} else if (flag.valueCompletion === "none") {
			// Suppress file completion — url/json values are not paths.
			valueSuffix = `:${valueLabel}: `;
		} else if (flag.type === "string") {
			valueSuffix = `:${valueLabel}:_files`;
		} else {
			valueSuffix = `:${valueLabel}: `;
		}
	}

	// Repeatable flags: prefix with `*` per zshcompsys so the spec can
	// match more than once (otherwise zsh hides used options after the
	// first occurrence). Boolean negation candidates (`--no-foo`) are
	// emitted as separate single-form specs further down.
	const repeat = flag.multiple === true ? "*" : "";

	// Pre-compute the alias spellings list for the mutual-exclusion prefix.
	const allLong = [flag.name, ...(flag.aliases ?? [])];
	const allShort = flag.short !== undefined ? [flag.short] : [];

	const specs: string[] = [];

	if (allShort.length === 0 && allLong.length === 1) {
		// Single long form — simplest spec.
		const eq = flag.takesValue ? "=" : "";
		const body = `${repeat}--${flag.name}${eq}${descPart}${valueSuffix}`;
		specs.push(zshSingleQuote(body));
	} else {
		// Multiple spellings — emit a mutex group. The standard zsh idiom
		// (per `man zshcompsys`) is:
		//   `(-h --help)'{-h,--help}'[desc]`
		// with the mutex names listed in parentheses and the brace
		// alternation expanding to one option per spelling. We
		// single-quote-wrap each piece so flag names with `-` survive
		// shell tokenisation cleanly.
		const mutex = [...allShort.map((s) => `-${s}`), ...allLong.map((l) => `--${l}`)].join(" ");
		const altGroup = [
			...allShort.map((s) => `-${s}`),
			...allLong.map((l) => `--${l}${flag.takesValue ? "=" : ""}`),
		].join(",");
		// Repeat marker in the brace alternation: `*{-h,--help}` ensures
		// each member of the alternation can repeat. The mutex prefix
		// `(...)` is only meaningful for non-repeatable specs.
		const headPrefix = flag.multiple === true ? "" : `(${mutex})`;
		const repeatBrace = flag.multiple === true ? "*" : "";
		// The spec is built without an outer wrapper so we can wrap the
		// whole thing in zsh single quotes after the brace alternation.
		// Example: '(--help -h)'{-h,--help}'[desc]' — three single-quoted
		// fragments concatenated. Each fragment is independently safe
		// because none of the quoted contents contain a single quote
		// (description quotes are escaped by zshArgsDescription).
		const fragments = [
			zshSingleQuote(headPrefix),
			`${repeatBrace}{${altGroup}}`,
			zshSingleQuote(`${descPart}${valueSuffix}`),
		];
		specs.push(fragments.join(""));
	}

	// `--no-<name>` for boolean toggles (matches the parser's
	// negation-acceptance contract). Emitted as a separate spec so it
	// shows up alongside `--<name>` in the menu.
	if (flag.type === "boolean" && flag.noNegate !== true) {
		const negDesc = `[${zshArgsDescription(`disable: ${desc}`.trim())}]`;
		const negNames = allLong.map((l) => `--no-${l}`);
		if (negNames.length === 1) {
			specs.push(zshSingleQuote(`${repeat}${negNames[0]}${negDesc}`));
		} else {
			const negMutex = negNames.join(" ");
			const negAlt = negNames.join(",");
			const headPrefix = flag.multiple === true ? "" : `(${negMutex})`;
			const repeatBrace = flag.multiple === true ? "*" : "";
			specs.push(
				[zshSingleQuote(headPrefix), `${repeatBrace}{${negAlt}}`, zshSingleQuote(negDesc)].join(""),
			);
		}
	}

	return specs;
}

/**
 * Render the positional-argument specs for a single command.
 *
 * Uses the same `'<idx>:NAME:<action>'` shape across leaf and non-leaf
 * helpers. Variadic args expand the `<idx>` to `*` and run the action
 * for every remaining word. Branches mirror {@link flagSpecs}:
 *   - choices                       → `(a b c)`
 *   - valueCompletion === "files"   → `_files`
 *   - valueCompletion === "none"    → ` ` (noop — url/json are not paths)
 *   - free-form string              → `_files`
 *   - number/bool                   → ` ` (noop — rare positional case)
 */
function renderArgSpecs(node: CompletionCommand): string[] {
	const specs: string[] = [];
	node.args.forEach((arg, idx) => {
		const idxToken = arg.variadic ? "*" : String(idx + 1);
		const label = arg.name;
		let action: string;
		if (arg.choices !== undefined && arg.choices.length > 0) {
			// Validated bare values — see comment in flagSpecs.
			action = `(${arg.choices.join(" ")})`;
		} else if (arg.valueCompletion === "none") {
			action = " ";
		} else if (arg.valueCompletion === "files" || arg.type === "string") {
			action = "_files";
		} else {
			action = " ";
		}
		specs.push(zshSingleQuote(`${idxToken}:${label}:${action}`));
	});
	return specs;
}

/**
 * Build the function name for the helper that handles a given command
 * path. The root is `_<ident>`; nested children append `_<segment>` for
 * each step.
 */
function helperName(rootIdent: string, path: readonly string[]): string {
	if (path.length === 0) return `_${rootIdent}`;
	return `_${rootIdent}_${path.map(toShellIdent).join("_")}`;
}

/**
 * Render a single command's helper function.
 *
 * - Leaf commands: declare flag specs and any positional arg specs.
 * - Non-leaf commands: add the standard `->state` routing and a `case`
 *   over `$line[1]` (the first non-option positional) that dispatches to
 *   each child helper. Aliases reuse the same helper as their canonical
 *   sibling.
 *
 * Non-leaf commands with positional args are uncommon but supported:
 * the routing emits `'1: :->cmds'` so the first slot is treated as a
 * subcommand, plus any *additional* positional specs (slots 2+) for the
 * declared args. If a CLI uses arg slot 1 AND has subcommands, the
 * subcommand wins for that slot — matches the parser's behaviour where
 * a known subcommand takes precedence over a positional value.
 */
function renderHelper(
	rootIdent: string,
	path: readonly string[],
	node: CompletionCommand,
	out: string[],
): void {
	const fnName = helperName(rootIdent, path);
	const flagSpecLines = renderFlagSpecs(node);
	const argSpecLines = renderArgSpecs(node);
	const hasChildren = node.subCommands.length > 0;

	out.push(`${fnName}() {`);

	if (hasChildren) {
		out.push("\tlocal context state state_descr line");
		out.push("\ttypeset -A opt_args");
		out.push("");
		out.push("\t_arguments -C \\");
		for (const spec of flagSpecLines) {
			out.push(`\t\t${spec} \\`);
		}
		out.push("\t\t'1: :->cmds' \\");
		out.push("\t\t'*::arg:->args'");
		out.push("");
		out.push('\tcase "$state" in');
		out.push("\t\tcmds)");
		out.push("\t\t\tlocal -a subcmds");
		out.push("\t\t\tsubcmds=(");
		for (const sub of node.subCommands) {
			const desc = zshDescribeField(sub.description ?? "");
			out.push(`\t\t\t\t${zshSingleQuote(`${zshDescribeField(sub.name)}:${desc}`)}`);
			if (sub.aliases !== undefined) {
				for (const alias of sub.aliases) {
					out.push(`\t\t\t\t${zshSingleQuote(`${zshDescribeField(alias)}:${desc}`)}`);
				}
			}
		}
		out.push("\t\t\t)");
		out.push("\t\t\t_describe 'subcommand' subcmds");
		out.push("\t\t\t;;");
		out.push("\t\targs)");
		out.push('\t\t\tcase "$line[1]" in');
		for (const sub of node.subCommands) {
			const childFn = helperName(rootIdent, [...path, sub.name]);
			// Each spelling becomes its own quoted case alternative — we
			// avoid `|`-joined patterns because a quoted alternation list
			// is simpler to keep literal (no glob metacharacter risk).
			const allSpellings = [sub.name, ...(sub.aliases ?? [])];
			const alts = allSpellings.map(zshSingleQuote).join("|");
			out.push(`\t\t\t\t${alts})`);
			out.push(`\t\t\t\t\t${childFn}`);
			out.push("\t\t\t\t\t;;");
		}
		out.push("\t\t\tesac");
		out.push("\t\t\t;;");
		out.push("\tesac");
	} else {
		// Leaf — flat _arguments call.
		if (flagSpecLines.length === 0 && argSpecLines.length === 0) {
			// Pure noop helper — keep an empty body so the caller's `case`
			// dispatch still has a target to jump to.
			out.push("\t:");
		} else {
			out.push("\t_arguments \\");
			const allSpecs: string[] = [...flagSpecLines, ...argSpecLines];
			allSpecs.forEach((spec, idx) => {
				const trailing = idx === allSpecs.length - 1 ? "" : " \\";
				out.push(`\t\t${spec}${trailing}`);
			});
		}
	}

	out.push("}");
	out.push("");

	for (const sub of node.subCommands) {
		renderHelper(rootIdent, [...path, sub.name], sub, out);
	}
}

/**
 * Render a self-contained zsh completion script for the given spec.
 *
 * The script is safe to drop into `$fpath` as `_<bin>` (autoloaded via the
 * `#compdef` magic line) AND safe to source inline via
 * `eval "$(mycli completion zsh)"` — the trailing `_<bin> "$@"` makes the
 * inline form actually invoke completion when the file is sourced.
 *
 * @param spec     Walker output.
 * @param binName  User-facing binary name; validated upstream via
 *                 {@link assertSafeBinName}.
 * @param version  Free-form version string for the header comment.
 */
export function renderZsh(spec: CompletionCommand, binName: string, version: string): string {
	const ident = toShellIdent(binName);
	const lines: string[] = [];

	// `#compdef` MUST be the first line for zsh's autoload mechanism.
	// `binName` was validated upstream; only the safe identifier set
	// reaches here, so a quoted compdef target is unnecessary (and `zsh`
	// itself rejects unusual `#compdef` arguments).
	lines.push(`#compdef ${binName}`);
	lines.push(
		`# completion script for ${binName} v${version} — regenerate with: ${binName} completion zsh`,
	);
	lines.push("");

	const helpers: string[] = [];
	renderHelper(ident, [], spec, helpers);
	lines.push(...helpers);

	// Bootstrap line. When zsh's autoload machinery sources the file via
	// `compdef`, it also calls the function — but if the user `source`s the
	// file by hand (the inline `eval` install), nothing has called the
	// entry function yet. Guard with `compdef` so the autoload path doesn't
	// double-invoke. Pattern adapted from yargs (research zsh.md §5.2).
	// `binName` is validated, so the bare form is safe; we still single-
	// quote it for readability and as defence-in-depth.
	lines.push(`if [ "$funcstack[1]" = "_${ident}" ]; then`);
	lines.push(`\t_${ident} "$@"`);
	lines.push("else");
	lines.push(`\tcompdef _${ident} ${zshSingleQuote(binName)}`);
	lines.push("fi");

	return `${lines.join("\n")}\n`;
}
