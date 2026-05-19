import { fishSingleQuote, sanitizeForComment } from "../escape.ts";
import type { CompletionCommand, CompletionSpec } from "../spec.ts";

/**
 * Pure-static fish completion script renderer.
 *
 * Strategy: emit declarative `complete -c <bin>` rules — one per
 * subcommand candidate, one per flag of every reachable command. Fish
 * accumulates rules into an in-memory table at `source` time and consults
 * them on every TAB; there's no entry-point function, no subprocess, and
 * no shell state to manage.
 *
 * **Subcommand routing.** We emit a single helper per script —
 * `__<ident>_path_is` — that walks `commandline -opc` left-to-right,
 * skips flags and the `--` end-of-options terminator, and verifies that
 * each consumed positional matches the expected canonical-or-alias set
 * for its depth in order. This replaces the stock
 * `__fish_seen_subcommand_from` chain (which is order-insensitive and
 * misroutes when the same name appears at different depths).
 */

function toShellIdent(name: string): string {
	return name.replace(/[^A-Za-z0-9_]/g, "_");
}

/** Build the space-joined spelling list for a command (canonical + aliases). */
function spellingsOf(node: CompletionCommand): string {
	const all: string[] = [node.name, ...(node.aliases ?? [])];
	return all.join(" ");
}

/** Build the space-joined "block" list — direct children of `node`. */
function childSpellings(node: CompletionCommand): string {
	const out: string[] = [];
	for (const sub of node.subCommands) {
		out.push(sub.name);
		if (sub.aliases !== undefined) out.push(...sub.aliases);
	}
	return out.join(" ");
}

interface RuleParts {
	condition?: string;
	short?: string;
	long?: string;
	arguments?: string;
	description?: string;
	exclusive?: boolean;
	requireParameter?: boolean;
	noFiles?: boolean;
}

/**
 * Render a single `complete -c <bin> ...` rule line.
 *
 * `binName` was validated upstream via `assertSafeBinName`, but we still
 * single-quote it as defence-in-depth so the line works even if a future
 * caller bypasses validation.
 */
function renderRule(binName: string, parts: RuleParts): string {
	const segments: string[] = [`complete -c ${fishSingleQuote(binName)}`];
	if (parts.condition !== undefined) {
		// The condition is fish code (one or more `; and` clauses); it is
		// constructed in this file and only references our own helper plus
		// validated identifiers, so we wrap it in single quotes so fish
		// passes it as a single `-n` argument.
		segments.push(`-n ${fishSingleQuote(parts.condition)}`);
	}
	if (parts.exclusive) segments.push("-x");
	else if (parts.requireParameter) segments.push("-r");
	else if (parts.noFiles) segments.push("-f");
	if (parts.short !== undefined) {
		segments.push(`-s ${fishSingleQuote(parts.short)}`);
	}
	if (parts.long !== undefined) {
		segments.push(`-l ${fishSingleQuote(parts.long)}`);
	}
	if (parts.arguments !== undefined) {
		// `-a` takes a single shell-token that fish later re-tokenises into
		// candidates. Embedding a multi-value list inside one shell-token
		// requires double-escaping (single-quote nesting + fish's later
		// re-tokenisation of the unwrapped string) which is fragile when
		// candidates contain whitespace or quotes. We therefore emit
		// **one rule per candidate** — each call passes a single
		// fish-quoted shell-token via `arguments`. Fish accumulates rules
		// with identical subjects/conditions into one candidate set.
		segments.push(`-a ${parts.arguments}`);
	}
	if (parts.description !== undefined) {
		segments.push(`-d ${fishSingleQuote(parts.description)}`);
	}
	return segments.join(" ");
}

/**
 * Build the `-n` predicate expression that matches "we are currently at
 * the command path `path` and no deeper subcommand has been entered".
 *
 * Always uses the per-script helper `__<ident>_path_is`. The helper
 * receives one argument per depth (space-joined acceptable spellings at
 * that depth) plus a final "block" argument that lists the child
 * spellings of the leaf — the helper rejects when any of those have
 * already appeared past the path.
 */
function pathPredicate(
	ident: string,
	path: readonly CompletionCommand[],
	leaf: CompletionCommand,
): string {
	const args: string[] = [];
	for (const node of path) {
		args.push(fishSingleQuote(spellingsOf(node)));
	}
	args.push(fishSingleQuote(childSpellings(leaf)));
	return `__${ident}_path_is ${args.join(" ")}`;
}

/**
 * Build the `-n` predicate for a positional-argument-choice rule.
 *
 * Calls `__<ident>_path_at_arg <spellings...> <pos_spec> <block>` where
 * `pos_spec` is either `<N>` (exact: completion fires when exactly N
 * positionals have been consumed past the path) or `*<N>` (variadic
 * fallback: fires when N-or-more positionals have been consumed, used
 * for variadic args with choices).
 *
 * Notes on layering: this helper is intentionally a parallel function
 * to `__<ident>_path_is` rather than a generalisation of it — the two
 * call sites (subcommand/flag rules vs positional-choice rules) want
 * distinct semantics and the call surfaces are clearer when each helper
 * does one thing.
 */
function posPredicate(
	ident: string,
	path: readonly CompletionCommand[],
	leaf: CompletionCommand,
	posSpec: string,
): string {
	const args: string[] = [];
	for (const node of path) {
		args.push(fishSingleQuote(spellingsOf(node)));
	}
	args.push(fishSingleQuote(posSpec));
	args.push(fishSingleQuote(childSpellings(leaf)));
	return `__${ident}_path_at_arg ${args.join(" ")}`;
}

/**
 * Recursively walk the command tree and emit:
 *   1. one subcommand-listing rule per child of the current node, gated
 *      on the path predicate — these surface child names + aliases with
 *      descriptions in the completion menu;
 *   2. one rule per flag of the current node;
 *   3. one rule per positional arg that declares choices (only the first
 *      slot — fish's `complete -a` model is best at offering a single
 *      candidate set; further slots fall through to filename completion
 *      via `-r` on the rule).
 */
function emitRules(
	binName: string,
	ident: string,
	path: readonly CompletionCommand[],
	current: CompletionCommand,
	out: string[],
): void {
	const condition = pathPredicate(ident, path, current);

	// Subcommand rules: emit one rule per spelling so each can carry its
	// own description in the menu. fishSingleQuote is applied via the
	// `arguments` pre-tokenisation path.
	for (const sub of current.subCommands) {
		const desc = sub.description ?? "";
		const spellings: string[] = [sub.name, ...(sub.aliases ?? [])];
		for (const spelling of spellings) {
			out.push(
				renderRule(binName, {
					condition,
					arguments: fishSingleQuote(spelling),
					description: desc,
					noFiles: true,
				}),
			);
		}
	}

	/**
	 * Emit choice values as a separate rule per candidate. See the note
	 * on {@link renderRule}'s `arguments` handling for why we don't
	 * pack them into one space-joined list.
	 */
	const emitChoiceFlag = (
		rule: RuleParts,
		choices: readonly string[],
	): void => {
		for (const choice of choices) {
			out.push(
				renderRule(binName, {
					...rule,
					exclusive: true,
					arguments: fishSingleQuote(choice),
				}),
			);
		}
	};

	// Flag rules.
	for (const flag of current.flags) {
		const desc = flag.description ?? "";
		const baseRule: RuleParts = {
			condition,
			long: flag.name,
			description: desc,
		};
		if (flag.short !== undefined) baseRule.short = flag.short;

		// Emit a single value-taking rule for `flag`. Branches:
		//   - choices       → one rule per literal candidate (via emitChoiceFlag)
		//   - isPath        → require parameter + `(__fish_complete_path)`
		//   - isUrl/isJson  → require parameter only; the script's leading
		//                     `complete -c <bin> -f` keeps file completion off
		//   - free-form     → require parameter (current behaviour)
		const emitValueRule = (rule: RuleParts) => {
			if (flag.choices !== undefined && flag.choices.length > 0) {
				emitChoiceFlag(rule, flag.choices);
				return;
			}
			if (flag.isPath === true) {
				out.push(
					renderRule(binName, {
						...rule,
						requireParameter: true,
						arguments: fishSingleQuote("(__fish_complete_path)"),
					}),
				);
				return;
			}
			out.push(renderRule(binName, { ...rule, requireParameter: true }));
		};

		if (flag.takesValue) {
			emitValueRule(baseRule);
		} else {
			out.push(renderRule(binName, baseRule));
		}

		// Aliases — emit additional rules with the same condition/desc but
		// using the alias as the long form.
		if (flag.aliases !== undefined) {
			for (const alias of flag.aliases) {
				const aliasRule: RuleParts = {
					condition,
					long: alias,
					description: desc,
				};
				if (flag.takesValue) {
					emitValueRule(aliasRule);
				} else {
					out.push(renderRule(binName, aliasRule));
				}
			}
		}

		// `--no-<name>` for boolean toggles.
		if (flag.type === "boolean" && flag.noNegate !== true) {
			const negDesc = `disable: ${desc}`.trim();
			out.push(
				renderRule(binName, {
					condition,
					long: `no-${flag.name}`,
					description: negDesc,
				}),
			);
			if (flag.aliases !== undefined) {
				for (const alias of flag.aliases) {
					out.push(
						renderRule(binName, {
							condition,
							long: `no-${alias}`,
							description: negDesc,
						}),
					);
				}
			}
		}
	}

	// Positional arg choices: emit one rule per (slot, choice value)
	// gated on the per-slot predicate `__<ident>_path_at_arg`. Fixed
	// slots fire only when the user is filling that exact slot; a
	// variadic-with-choices arg fires for every slot from its declared
	// index onwards (`*<N>` spec).
	current.args.forEach((arg, idx) => {
		if (arg.choices === undefined || arg.choices.length === 0) return;
		const posSpec = arg.variadic ? `*${idx}` : String(idx);
		const posCondition = posPredicate(ident, path, current, posSpec);
		for (const choice of arg.choices) {
			out.push(
				renderRule(binName, {
					condition: posCondition,
					arguments: fishSingleQuote(choice),
					description: arg.description ?? "",
					noFiles: true,
				}),
			);
		}
	});

	// Recurse.
	for (const sub of current.subCommands) {
		emitRules(binName, ident, [...path, sub], sub, out);
	}
}

/**
 * Emit the per-script `__<ident>_path_is` helper. See
 * {@link pathPredicate} for the calling convention.
 *
 * The helper walks `commandline -opc` (the line tokens up to the cursor),
 * skipping the program name, all `-*` tokens, and everything after `--`.
 * It then checks each consumed positional matches the expected
 * spelling-list at depth `i`, in order. Past the path, it returns 1 if
 * any of the leaf's children have been entered (so deeper paths win and
 * shallower predicates stop matching).
 */
function emitHelper(ident: string): string[] {
	const fn = `__${ident}_path_is`;
	const lines: string[] = [];
	lines.push(`function ${fn}`);
	lines.push("\tset -l n (math (count $argv) - 1)");
	lines.push('\tset -l block (string split " " -- $argv[-1])');
	lines.push("\tset -l tokens (commandline -opc)");
	lines.push("\tset -l total (count $tokens)");
	// Skip the program name (token 1).
	lines.push("\tset -l j 2");
	lines.push("\tset -l consumed 0");
	lines.push("\tset -l end_of_options 0");
	lines.push("\twhile test $j -le $total");
	lines.push("\t\tset -l t $tokens[$j]");
	lines.push('\t\tif test "$t" = "--"');
	lines.push("\t\t\tset end_of_options 1");
	lines.push("\t\t\tset j (math $j + 1)");
	lines.push("\t\t\tcontinue");
	lines.push("\t\tend");
	lines.push(
		"\t\tif test $end_of_options -eq 0; and string match -q -- '-*' $t",
	);
	lines.push("\t\t\tset j (math $j + 1)");
	lines.push("\t\t\tcontinue");
	lines.push("\t\tend");
	lines.push("\t\tif test $consumed -lt $n");
	lines.push(
		'\t\t\tset -l alts (string split " " -- $argv[(math $consumed + 1)])',
	);
	lines.push("\t\t\tif not contains -- $t $alts");
	lines.push("\t\t\t\treturn 1");
	lines.push("\t\t\tend");
	lines.push("\t\t\tset consumed (math $consumed + 1)");
	lines.push("\t\telse");
	lines.push("\t\t\tif contains -- $t $block");
	lines.push("\t\t\t\treturn 1");
	lines.push("\t\t\tend");
	lines.push("\t\tend");
	lines.push("\t\tset j (math $j + 1)");
	lines.push("\tend");
	lines.push("\ttest $consumed -eq $n");
	lines.push("end");
	return lines;
}

/**
 * Emit the per-script `__<ident>_path_at_arg` helper. Like
 * {@link emitHelper} but takes an extra `pos_spec` argument before the
 * block list. `pos_spec` is `<N>` (fires when exactly N positionals have
 * been consumed past the path — the cursor is filling slot N) or
 * `*<N>` (variadic; fires when N-or-more positionals have been
 * consumed, used for variadic-with-choices args).
 *
 * The walking loop is identical to `__<ident>_path_is`; only the final
 * test differs. Kept as a separate helper rather than a parameterised
 * superset of the existing one so call sites stay declarative — a
 * subcommand rule wants "we are at this path, nothing further typed",
 * not "we are at this path with offset=0".
 */
function emitPosHelper(ident: string): string[] {
	const fn = `__${ident}_path_at_arg`;
	const lines: string[] = [];
	lines.push(`function ${fn}`);
	lines.push("\tset -l total_argv (count $argv)");
	lines.push('\tset -l block (string split " " -- $argv[$total_argv])');
	lines.push("\tset -l pos_spec $argv[(math $total_argv - 1)]");
	lines.push("\tset -l n (math $total_argv - 2)");
	lines.push("\tset -l variadic 0");
	lines.push("\tset -l target $pos_spec");
	lines.push("\tif string match -q -- '\\**' $pos_spec");
	lines.push("\t\tset variadic 1");
	lines.push("\t\tset target (string sub --start 2 -- $pos_spec)");
	lines.push("\tend");
	lines.push("\tset -l tokens (commandline -opc)");
	lines.push("\tset -l total (count $tokens)");
	lines.push("\tset -l j 2");
	lines.push("\tset -l consumed 0");
	lines.push("\tset -l end_of_options 0");
	lines.push("\twhile test $j -le $total");
	lines.push("\t\tset -l t $tokens[$j]");
	lines.push('\t\tif test "$t" = "--"');
	lines.push("\t\t\tset end_of_options 1");
	lines.push("\t\t\tset j (math $j + 1)");
	lines.push("\t\t\tcontinue");
	lines.push("\t\tend");
	lines.push(
		"\t\tif test $end_of_options -eq 0; and string match -q -- '-*' $t",
	);
	lines.push("\t\t\tset j (math $j + 1)");
	lines.push("\t\t\tcontinue");
	lines.push("\t\tend");
	lines.push("\t\tif test $consumed -lt $n");
	lines.push(
		'\t\t\tset -l alts (string split " " -- $argv[(math $consumed + 1)])',
	);
	lines.push("\t\t\tif not contains -- $t $alts");
	lines.push("\t\t\t\treturn 1");
	lines.push("\t\t\tend");
	lines.push("\t\t\tset consumed (math $consumed + 1)");
	lines.push("\t\telse");
	lines.push("\t\t\tif contains -- $t $block");
	lines.push("\t\t\t\treturn 1");
	lines.push("\t\t\tend");
	lines.push("\t\t\tset consumed (math $consumed + 1)");
	lines.push("\t\tend");
	lines.push("\t\tset j (math $j + 1)");
	lines.push("\tend");
	lines.push("\tset -l beyond (math $consumed - $n)");
	lines.push("\tif test $variadic -eq 1");
	lines.push("\t\ttest $beyond -ge $target");
	lines.push("\telse");
	lines.push("\t\ttest $beyond -eq $target");
	lines.push("\tend");
	lines.push("end");
	return lines;
}

/**
 * Render a self-contained fish completion script for the given spec.
 *
 * The script is safe to drop into `~/.config/fish/completions/<bin>.fish`
 * (auto-loaded the first time the user types `<bin>`) AND safe to source
 * inline via `mycli completion fish | source` — both paths just register
 * `complete` rules.
 *
 * @param spec     Walker output.
 * @param binName  User-facing binary name; validated upstream.
 * @param version  Free-form version string for the header comment.
 */
export function renderFish(
	spec: CompletionSpec,
	binName: string,
	version: string,
): string {
	const ident = toShellIdent(binName);
	const lines: string[] = [];

	const safeBin = sanitizeForComment(binName);
	const safeVersion = sanitizeForComment(version);
	lines.push(
		`# completion script for ${safeBin} v${safeVersion} — regenerate with: ${safeBin} completion fish`,
	);
	lines.push("");

	// Emit the path-resolution helpers before any rules reference them.
	lines.push(...emitHelper(ident));
	lines.push("");
	lines.push(...emitPosHelper(ident));
	lines.push("");

	// Disable file completion globally for the command. Individual rules
	// re-enable filesystem completion via `-r` (free-form value flags) or
	// stay file-less via `-x` (enum flags) as appropriate.
	lines.push(`complete -c ${fishSingleQuote(binName)} -f`);
	lines.push("");

	const rules: string[] = [];
	emitRules(binName, ident, [], spec.root, rules);
	lines.push(...rules);

	return `${lines.join("\n")}\n`;
}
