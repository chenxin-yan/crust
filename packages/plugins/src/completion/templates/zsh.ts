import type {
	CompletionCommand,
	CompletionFlag,
	CompletionSpec,
} from "../spec.ts";

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
 */

function toShellIdent(name: string): string {
	return name.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Escape a string for inclusion inside a zsh `_arguments` spec's `[desc]`
 * bracket. Per `man zshcompsys`, description text in `_arguments` runs
 * until the matching `]`, and `:` is the field separator, so we backslash
 * those plus backslash itself. We also drop newlines defensively.
 */
function escZshDesc(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/\[/g, "\\[")
		.replace(/]/g, "\\]")
		.replace(/:/g, "\\:")
		.replace(/[\r\n]+/g, " ");
}

/**
 * Escape a value for inclusion in a zsh single-quoted string.
 * Single quotes have no escape sequence; close-and-concat is the standard
 * idiom (`'foo'\''bar'` for `foo'bar`). Choice/subcommand values rarely
 * carry quotes in practice, but we are defensive.
 */
function escSingleQuoted(value: string): string {
	return value.replace(/'/g, "'\\''");
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
	const descPart = `[${escZshDesc(desc)}]`;

	// Build the value-action suffix once: empty for booleans, ` :NAME:`
	// for free-form values, ` :NAME:(opt1 opt2)` for choice flags.
	let valueSuffix = "";
	if (flag.takesValue) {
		const valueLabel = flag.name; // shown as the prompt placeholder
		if (flag.choices !== undefined && flag.choices.length > 0) {
			const opts = flag.choices.map(escSingleQuoted).join(" ");
			valueSuffix = `:${valueLabel}:(${opts})`;
		} else {
			valueSuffix = `:${valueLabel}:`;
		}
	}

	// Pre-compute the alias spellings list for the mutual-exclusion prefix.
	const allLong = [flag.name, ...(flag.aliases ?? [])];
	const allShort = flag.short !== undefined ? [flag.short] : [];

	if (allShort.length === 0 && allLong.length === 1) {
		// Single long form — simplest spec.
		const eq = flag.takesValue ? "=" : "";
		return [`'--${flag.name}${eq}${descPart}${valueSuffix}'`];
	}

	// Multiple spellings — emit a mutex group. The standard zsh idiom:
	// `'(-h --help)'{-h,--help}'[desc]'`
	const mutex = [
		...allShort.map((s) => `-${s}`),
		...allLong.map((l) => `--${l}`),
	].join(" ");
	const altGroup = [
		...allShort.map((s) => `-${s}`),
		...allLong.map((l) => `--${l}${flag.takesValue ? "=" : ""}`),
	].join(",");

	return [`'(${mutex})'{${altGroup}}'${descPart}${valueSuffix}'`];
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
 * - Leaf commands: declare flag specs and an optional final `*: :_files`
 *   for free positional arguments.
 * - Non-leaf commands: add the standard `->state` routing and a `case`
 *   over `$line[1]` (the first non-option positional) that dispatches to
 *   each child helper. Aliases reuse the same helper as their canonical
 *   sibling.
 */
function renderHelper(
	rootIdent: string,
	path: readonly string[],
	node: CompletionCommand,
	out: string[],
): void {
	const fnName = helperName(rootIdent, path);
	const flagSpecLines = renderFlagSpecs(node);
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
			const desc = escSingleQuoted(sub.description ?? "");
			out.push(`\t\t\t\t'${escSingleQuoted(sub.name)}:${desc}'`);
			if (sub.aliases !== undefined) {
				for (const alias of sub.aliases) {
					out.push(`\t\t\t\t'${escSingleQuoted(alias)}:${desc}'`);
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
			const names = [sub.name, ...(sub.aliases ?? [])]
				.map(escSingleQuoted)
				.join("|");
			out.push(`\t\t\t\t${names})`);
			out.push(`\t\t\t\t\t${childFn}`);
			out.push("\t\t\t\t\t;;");
		}
		out.push("\t\t\tesac");
		out.push("\t\t\t;;");
		out.push("\tesac");
	} else {
		// Leaf — flat _arguments call. If the command declares positional
		// args we emit `*: :_files` so files are offered for free-form
		// positional slots; otherwise we omit it to keep the menu clean.
		if (flagSpecLines.length === 0 && node.args.length === 0) {
			// Pure noop helper — keep an empty body so the caller's `case`
			// dispatch still has a target to jump to.
			out.push("\t:");
		} else {
			out.push("\t_arguments \\");
			const lines: string[] = [...flagSpecLines];
			if (node.args.length > 0) {
				// Surface choices on positional args via positional spec
				// `1:NAME:(a b c)`. Variadic args use the trailing `*:`.
				node.args.forEach((arg, idx) => {
					const idxToken = arg.variadic ? "*" : String(idx + 1);
					const label = arg.name;
					if (arg.choices !== undefined && arg.choices.length > 0) {
						const opts = arg.choices.map(escSingleQuoted).join(" ");
						lines.push(`'${idxToken}:${label}:(${opts})'`);
					} else if (arg.type === "string") {
						lines.push(`'${idxToken}:${label}:_files'`);
					} else {
						lines.push(`'${idxToken}:${label}:'`);
					}
				});
			}
			lines.forEach((spec, idx) => {
				const trailing = idx === lines.length - 1 ? "" : " \\";
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
 * @param binName  User-facing binary name. The `#compdef` line and the
 *                 entry-point function name derive from it.
 * @param version  Free-form version string for the header comment.
 */
export function renderZsh(
	spec: CompletionSpec,
	binName: string,
	version: string,
): string {
	const ident = toShellIdent(binName);
	const lines: string[] = [];

	// `#compdef` MUST be the first line for zsh's autoload mechanism.
	lines.push(`#compdef ${binName}`);
	lines.push(
		`# completion script for ${binName} v${version} — regenerate with: ${binName} completion zsh`,
	);
	lines.push("");

	const helpers: string[] = [];
	renderHelper(ident, [], spec.root, helpers);
	lines.push(...helpers);

	// Bootstrap line. When zsh's autoload machinery sources the file via
	// `compdef`, it also calls the function — but if the user `source`s the
	// file by hand (the inline `eval` install), nothing has called the
	// entry function yet. Guard with `compdef` so the autoload path doesn't
	// double-invoke. Pattern adapted from yargs (research zsh.md §5.2).
	lines.push(`if [ "$funcstack[1]" = "_${ident}" ]; then`);
	lines.push(`\t_${ident} "$@"`);
	lines.push("else");
	lines.push(`\tcompdef _${ident} ${binName}`);
	lines.push("fi");

	return `${lines.join("\n")}\n`;
}
