import { fishSingleQuote, toShellIdent } from "../escape.ts";
import type { CompletionCommand } from "../spec.ts";

/**
 * Pure-static fish completion script renderer.
 *
 * Strategy: emit declarative `complete -c <bin>` rules — one per
 * subcommand candidate, one per flag of every reachable command. Fish
 * accumulates rules into an in-memory table at `source` time and consults
 * them on every TAB; there's no entry-point function, no subprocess, and
 * no shell state to manage.
 *
 * **Subcommand routing.** We emit a single routing helper per script —
 * `__<ident>_path_at_arg` — that walks `commandline -opc` left-to-right,
 * skips flags (plus the separate value of a flag that takes one at the
 * current routing depth, decided by `__<ident>_takes_value`) and the
 * `--` end-of-options terminator, and verifies that
 * each consumed positional matches the expected canonical-or-alias set
 * for its depth in order. This replaces the stock
 * `__fish_seen_subcommand_from` chain (which is order-insensitive and
 * misroutes when the same name appears at different depths).
 */

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
 * Build the `-n` path and positional-argument predicate.
 *
 * Calls `__<ident>_path_at_arg <spellings...> <pos_spec> <block>` where
 * `pos_spec` is either `<N>` (exact: completion fires when exactly N
 * positionals have been consumed past the path) or `*<N>` (fires when
 * N-or-more positionals have been consumed).
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
 *   3. per-slot rules for positional args that declare choices or path
 *      completion, gated on {@link posPredicate}.
 */
function emitRules(
	binName: string,
	ident: string,
	path: readonly CompletionCommand[],
	current: CompletionCommand,
	out: string[],
): void {
	const condition = posPredicate(ident, path, current, "*0");

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
	const emitChoiceFlag = (rule: RuleParts, choices: readonly string[]): void => {
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

		// Emit a single value-taking rule for `flag`. Branches:
		//   - choices                       → one rule per literal candidate
		//   - valueCompletion === "files"   → require parameter + `(__fish_complete_path)`
		//   - otherwise (url/json/free-form) → require parameter only; the
		//                                      script's leading `complete -c <bin> -f`
		//                                      keeps file completion off
		const emitValueRule = (rule: RuleParts) => {
			if (flag.choices !== undefined) {
				emitChoiceFlag(rule, flag.choices);
				return;
			}
			if (flag.valueCompletion === "files") {
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

		for (const spelling of flag.spellings) {
			if (spelling.startsWith("--no-")) {
				out.push(
					renderRule(binName, {
						condition,
						long: spelling.slice(2),
						description: `disable: ${desc}`.trim(),
					}),
				);
				continue;
			}
			const rule: RuleParts = spelling.startsWith("--")
				? { condition, long: spelling.slice(2), description: desc }
				: { condition, short: spelling.slice(1), description: desc };
			if (flag.takesValue) {
				emitValueRule(rule);
			} else {
				out.push(renderRule(binName, rule));
			}
		}
	}

	// Positional arg choices: emit one rule per (slot, choice value)
	// gated on the per-slot predicate `__<ident>_path_at_arg`. Fixed
	// slots fire only when the user is filling that exact slot; a
	// variadic-with-choices arg fires for every slot from its declared
	// index onwards (`*<N>` spec).
	//
	// Path positionals get one `(__fish_complete_path)` rule per slot.
	// url/json positionals need no rule: the script's leading
	// `complete -c <bin> -f` already keeps file completion off, so the
	// suppression is implicit.
	current.args.forEach((arg, idx) => {
		const posSpec = arg.variadic ? `*${idx}` : String(idx);
		if (arg.choices !== undefined) {
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
			return;
		}
		if (arg.valueCompletion === "files") {
			const posCondition = posPredicate(ident, path, current, posSpec);
			out.push(
				renderRule(binName, {
					condition: posCondition,
					arguments: fishSingleQuote("(__fish_complete_path)"),
					description: arg.description ?? "",
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
 * Emit the flag-scope helpers used by routing:
 *
 * - `__<ident>_flags <value|bool> <canonical path...>` prints that command's
 *   value-taking spellings or boolean single-dash spellings.
 * - `__<ident>_takes_value <token> <canonical path...>` succeeds when `token`
 *   consumes the next argv token at that command, like Core's
 *   `matchKnownFlagToken`: `--name`/`-s` of a value flag, or a short bundle
 *   of known booleans ending in a value short (`-qs`). `--name=value`,
 *   `-svalue` and bundles with an unknown character consume nothing.
 */
function emitFlagScopeHelpers(ident: string, spec: CompletionCommand): string[] {
	const lines: string[] = [`function __${ident}_flags`];
	let branch = "if";
	const emitBranch = (key: readonly string[], spellings: readonly string[]): void => {
		if (spellings.length === 0) return;
		lines.push(`\t${branch} test "$argv" = ${fishSingleQuote(key.join(" "))}`);
		lines.push(`\t\tprintf '%s\\n' ${spellings.map(fishSingleQuote).join(" ")}`);
		branch = "else if";
	};
	const visit = (node: CompletionCommand, route: readonly string[]): void => {
		emitBranch(
			["value", ...route],
			node.flags.flatMap((flag) => (flag.takesValue ? flag.spellings : [])),
		);
		emitBranch(
			["bool", ...route],
			// Core matches bundle characters against every spelling, so
			// one-character canonical names and aliases count as shorts.
			node.flags.flatMap((flag) =>
				flag.takesValue ? [] : flag.spellings.filter((spelling) => !spelling.startsWith("--")),
			),
		);
		for (const sub of node.subCommands) visit(sub, [...route, sub.name]);
	};
	visit(spec, []);
	if (branch !== "if") lines.push("\tend");
	lines.push("end");
	lines.push("");
	lines.push(`function __${ident}_takes_value`);
	lines.push("\tset -l t $argv[1]");
	lines.push("\tset -e argv[1]");
	lines.push(`\tset -l value_flags (__${ident}_flags value $argv)`);
	lines.push("\tcontains -- $t $value_flags; and return 0");
	lines.push("\tstring match -q -- '--*' $t; and return 1");
	lines.push(`\tset -l bool_shorts (__${ident}_flags bool $argv)`);
	lines.push("\tset -l chars (string split '' -- (string sub --start 2 -- $t))");
	lines.push("\tset -l k 0");
	lines.push("\tfor c in $chars");
	lines.push("\t\tset k (math $k + 1)");
	lines.push("\t\tif contains -- -$c $value_flags");
	lines.push("\t\t\ttest $k -eq (count $chars)");
	lines.push("\t\t\treturn");
	lines.push("\t\tend");
	lines.push("\t\tcontains -- -$c $bool_shorts; or return 1");
	lines.push("\tend");
	lines.push("\treturn 1");
	lines.push("end");
	return lines;
}

/**
 * Emit the per-script `__<ident>_path_at_arg` helper. It takes a
 * `pos_spec` argument before the block list. `pos_spec` is `<N>` (fires
 * when exactly N positionals have
 * been consumed past the path — the cursor is filling slot N) or
 * `*<N>` (variadic; fires when N-or-more positionals have been
 * consumed, used for variadic-with-choices args and path matching).
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
	// Canonical names of the path consumed so far select the flag scope,
	// mirroring Core routing, which consumes known flags per depth.
	// `forwarded` holds value-consuming flag tokens seen before the next
	// path element; Core descends only when that child consumes them too.
	lines.push("\tset -l route");
	lines.push("\tset -l forwarded");
	lines.push("\twhile test $j -le $total");
	lines.push("\t\tset -l t $tokens[$j]");
	lines.push('\t\tif test "$t" = "--"');
	lines.push("\t\t\tset end_of_options 1");
	lines.push("\t\t\tset j (math $j + 1)");
	lines.push("\t\t\tcontinue");
	lines.push("\t\tend");
	lines.push("\t\tif test $end_of_options -eq 0; and string match -q -- '-*' $t");
	lines.push("\t\t\tset -l skip 1");
	lines.push(`\t\t\tif __${ident}_takes_value $t $route`);
	lines.push("\t\t\t\tset skip 2");
	lines.push("\t\t\t\tset -a forwarded $t");
	lines.push("\t\t\tend");
	lines.push("\t\t\tset j (math $j + $skip)");
	lines.push("\t\t\tcontinue");
	lines.push("\t\tend");
	lines.push("\t\tif test $consumed -lt $n");
	lines.push('\t\t\tset -l alts (string split " " -- $argv[(math $consumed + 1)])');
	lines.push("\t\t\tif not contains -- $t $alts");
	lines.push("\t\t\t\treturn 1");
	lines.push("\t\t\tend");
	lines.push("\t\t\tset consumed (math $consumed + 1)");
	lines.push("\t\t\tset -a route $alts[1]");
	lines.push("\t\t\tfor f in $forwarded");
	lines.push(`\t\t\t\t__${ident}_takes_value $f $route; or return 1`);
	lines.push("\t\t\tend");
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
 * @param command  Completion subcommand name for the header's regenerate hint.
 */
export function renderFish(
	spec: CompletionCommand,
	binName: string,
	version: string,
	command = "completion",
): string {
	const ident = toShellIdent(binName);
	const lines: string[] = [];

	lines.push(
		`# completion script for ${binName} v${version} — regenerate with: ${binName} ${command} fish`,
	);
	lines.push("");

	// Emit the path-resolution helpers before any rules reference them.
	lines.push(...emitFlagScopeHelpers(ident, spec));
	lines.push(...emitPosHelper(ident));
	lines.push("");

	// Disable file completion globally for the command. Path flags and
	// positionals opt back in with `(__fish_complete_path)` candidates;
	// enum flags use `-x` to stay file-less.
	lines.push(`complete -c ${fishSingleQuote(binName)} -f`);
	lines.push("");

	const rules: string[] = [];
	emitRules(binName, ident, [], spec, rules);
	lines.push(...rules);

	return `${lines.join("\n")}\n`;
}
