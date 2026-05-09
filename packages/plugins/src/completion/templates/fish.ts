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
 * Subcommand routing uses chained
 * `-n '__fish_seen_subcommand_from <parent-chain>; and not __fish_seen_subcommand_from <siblings>'`
 * predicates. That's slightly more verbose than the bash/zsh dispatch but
 * is fish's idiomatic shape and matches what `share/completions/git.fish`
 * and the Cobra/clap_complete fish output emit.
 */

/**
 * Escape a string for inclusion inside a fish single-quoted string. Fish
 * single quotes only escape `\\` and `\'`; everything else is literal.
 */
function escSingleQuoted(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Escape arbitrary text for inclusion in a fish description (`-d '...'`).
 * Same rules as a fish single-quoted string. We also collapse newlines.
 */
function escDescription(value: string): string {
	return escSingleQuoted(value.replace(/[\r\n]+/g, " "));
}

/**
 * Render a single `complete -c <bin> ...` rule line. Trailing flags omitted
 * when not applicable so the output stays readable.
 */
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

function renderRule(binName: string, parts: RuleParts): string {
	const segments: string[] = [`complete -c ${binName}`];
	if (parts.condition !== undefined) {
		segments.push(`-n '${parts.condition}'`);
	}
	if (parts.exclusive) segments.push("-x");
	else if (parts.requireParameter) segments.push("-r");
	else if (parts.noFiles) segments.push("-f");
	if (parts.short !== undefined) segments.push(`-s ${parts.short}`);
	if (parts.long !== undefined) segments.push(`-l ${parts.long}`);
	if (parts.arguments !== undefined) {
		segments.push(`-a '${parts.arguments}'`);
	}
	if (parts.description !== undefined) {
		segments.push(`-d '${escDescription(parts.description)}'`);
	}
	return segments.join(" ");
}

/**
 * Build the fish predicate that matches "we are currently inside the
 * command path `path`, and no further subcommand has been entered yet".
 *
 * - Empty path  → `__fish_use_subcommand`
 *   (top level: no subcommand entered yet)
 * - `["build"]` → `__fish_seen_subcommand_from build; and not __fish_seen_subcommand_from <build's children>`
 *   …but if `build` has no subcommands, just the first half.
 *
 * The full chain matters for nested commands: at `mycli deploy prod` we
 * need `seen_subcommand_from deploy; and seen_subcommand_from prod`.
 */
function inPathPredicate(
	path: readonly CompletionCommand[],
): string | undefined {
	if (path.length === 0) {
		return "__fish_use_subcommand";
	}

	// Build the chain of `seen_subcommand_from` clauses, one per depth
	// step. Each clause must accept any spelling (canonical + aliases).
	const seenClauses: string[] = [];
	for (const node of path) {
		const spellings = [node.name, ...(node.aliases ?? [])].join(" ");
		seenClauses.push(`__fish_seen_subcommand_from ${spellings}`);
	}

	// Negate any deeper subcommand on the leaf node so we don't suggest
	// `prod`'s flags after the user has typed `prod something`.
	const leaf = path[path.length - 1];
	if (leaf === undefined) return undefined;
	const childSpellings: string[] = [];
	for (const sub of leaf.subCommands) {
		childSpellings.push(sub.name);
		if (sub.aliases !== undefined) childSpellings.push(...sub.aliases);
	}

	const parts = [...seenClauses];
	if (childSpellings.length > 0) {
		parts.push(`not __fish_seen_subcommand_from ${childSpellings.join(" ")}`);
	}
	return parts.join("; and ");
}

/**
 * Recursively walk the command tree and emit:
 *   1. one subcommand-listing rule per child of the current node, gated
 *      on `inPathPredicate(path)` — these surface child names + aliases
 *      with descriptions in the completion menu;
 *   2. one rule per flag of the current node, also gated on the path
 *      predicate, so flags only show up at the right depth.
 */
function emitRules(
	binName: string,
	path: readonly CompletionCommand[],
	current: CompletionCommand,
	out: string[],
): void {
	const condition = inPathPredicate(path);

	// Subcommand rules: emit one rule per child spelling so each can carry
	// its own description in the menu.
	for (const sub of current.subCommands) {
		const desc = sub.description ?? "";
		const spellings = [sub.name, ...(sub.aliases ?? [])];
		for (const spelling of spellings) {
			out.push(
				renderRule(binName, {
					condition,
					arguments: escSingleQuoted(spelling),
					description: desc,
					noFiles: true,
				}),
			);
		}
	}

	// Flag rules.
	for (const flag of current.flags) {
		const desc = flag.description ?? "";
		const baseRule: RuleParts = {
			condition,
			long: flag.name,
			description: desc,
		};
		if (flag.short !== undefined) baseRule.short = flag.short;

		if (flag.takesValue) {
			if (flag.choices !== undefined && flag.choices.length > 0) {
				// Choice flag: -x (require param + no files) + `-a`.
				out.push(
					renderRule(binName, {
						...baseRule,
						exclusive: true,
						arguments: flag.choices.map(escSingleQuoted).join(" "),
					}),
				);
			} else {
				// Free-form value flag: -r so fish offers files after the flag.
				out.push(renderRule(binName, { ...baseRule, requireParameter: true }));
			}
		} else {
			// Boolean toggle: no -r/-x, no -a.
			out.push(renderRule(binName, baseRule));
		}

		// Aliases — emit additional rules with the same condition/desc but
		// using the alias as the long form. Aliases without a short alias
		// get rendered as long-only rules.
		if (flag.aliases !== undefined) {
			for (const alias of flag.aliases) {
				const aliasRule: RuleParts = {
					condition,
					long: alias,
					description: desc,
				};
				if (flag.takesValue) {
					if (flag.choices !== undefined && flag.choices.length > 0) {
						out.push(
							renderRule(binName, {
								...aliasRule,
								exclusive: true,
								arguments: flag.choices.map(escSingleQuoted).join(" "),
							}),
						);
					} else {
						out.push(
							renderRule(binName, {
								...aliasRule,
								requireParameter: true,
							}),
						);
					}
				} else {
					out.push(renderRule(binName, aliasRule));
				}
			}
		}
	}

	// Recurse into children.
	for (const sub of current.subCommands) {
		emitRules(binName, [...path, sub], sub, out);
	}
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
 * @param binName  User-facing binary name.
 * @param version  Free-form version string for the header comment.
 */
export function renderFish(
	spec: CompletionSpec,
	binName: string,
	version: string,
): string {
	const lines: string[] = [];

	lines.push(
		`# completion script for ${binName} v${version} — regenerate with: ${binName} completion fish`,
	);
	lines.push("");

	// Disable file completion globally for the command. Individual rules
	// re-enable filesystem completion via `-r` (free-form value flags) or
	// stay file-less via `-x` (enum flags) as appropriate.
	lines.push(`complete -c ${binName} -f`);
	lines.push("");

	const rules: string[] = [];
	emitRules(binName, [], spec.root, rules);
	lines.push(...rules);

	return `${lines.join("\n")}\n`;
}
