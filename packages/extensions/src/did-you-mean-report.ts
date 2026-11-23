import type { CommandSnapshot, CrustError, ExtensionContext, FlagSnapshot } from "@crustjs/core";
import { isListed } from "@crustjs/core/tooling";

import type { RenderHelpOptions } from "./help.ts";

function levenshtein(a: string, b: string): number {
	const aLen = a.length;
	const bLen = b.length;

	if (aLen === 0) return bLen;
	if (bLen === 0) return aLen;

	const row = Uint32Array.from({ length: bLen + 1 }, (_, i) => i);

	for (let i = 1; i <= aLen; i++) {
		let prev = i;
		for (let j = 1; j <= bLen; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			// SAFETY: j is bounded to 1..bLen and row has bLen + 1 entries.
			const val = Math.min(row[j]! + 1, prev + 1, row[j - 1]! + cost);
			row[j - 1] = prev;
			prev = val;
		}
		row[bLen] = prev;
	}

	// SAFETY: row has bLen + 1 entries.
	return row[bLen]!;
}

/**
 * The best suggestion for `input`: each candidate is the name to suggest and the
 * spellings that match it, so an alias maps back to its canonical name. The better
 * score of a candidate's spellings counts, and ties go to the alphabetically first name.
 *
 * A spelling matches when it starts with `input` (a forward-completion hint for a
 * typed prefix) or is within two edits of it, cobra's cutoff. An empty input matches
 * nothing. The reverse `input.startsWith(spelling)` shortcut is omitted: any 1–2 char
 * alias would falsely match every typo as distance 0.
 */
function findSuggestion(
	input: string,
	candidates: Iterable<readonly [name: string, spellings: readonly string[]]>,
): string | undefined {
	if (input === "") return undefined;
	let bestName: string | undefined;
	let bestDistance = Infinity;

	for (const [name, spellings] of candidates) {
		let distance = Infinity;
		for (const spelling of spellings) {
			distance = Math.min(distance, spelling.startsWith(input) ? 0 : levenshtein(input, spelling));
		}
		if (
			distance <= 2 &&
			(bestName === undefined ||
				distance < bestDistance ||
				(distance === bestDistance && name.localeCompare(bestName) < 0))
		) {
			bestName = name;
			bestDistance = distance;
		}
	}

	return bestName;
}

/**
 * Listed subcommands, by canonical name and aliases. Hidden ones (e.g. `__complete`)
 * stay invocable by name but never leak into suggestions.
 */
function* commandCandidates(
	subCommands: Readonly<Record<string, CommandSnapshot>>,
): Generator<readonly [string, readonly string[]]> {
	for (const [name, node] of Object.entries(subCommands)) {
		if (isListed(node)) yield [name, [name, ...(node.meta.aliases ?? [])]];
	}
}

/** Visible long spellings of `flags`, without dashes; an exclusive group's members stand for it. */
function* flagCandidates(
	flags: Readonly<Record<string, FlagSnapshot>>,
): Generator<readonly [string, readonly string[]]> {
	for (const [name, flag] of Object.entries(flags)) {
		if (flag.hidden) continue;
		if (flag.flags) {
			yield* flagCandidates(flag.flags);
			continue;
		}
		yield [name, [name, ...(flag.aliases ?? []).filter((alias) => alias.length > 1)]];
		if (flag.negatable) yield [`no-${name}`, [`no-${name}`]];
	}
}

/**
 * Append a suggestion to an unknown-flag error's message; loaded only when one occurs.
 * The error then renders as usual, so `--json` and Core's `Error:` line both carry it.
 */
export function suggestFlag(error: CrustError<"PARSE">, command: CommandSnapshot): void {
	const flag = error.details?.flag;
	// A one-letter name may be a short flag, and any short name is within two edits of it.
	if (flag === undefined || flag.length < 2) return;
	const suggestion = findSuggestion(flag, flagCandidates(command.flags));
	if (suggestion !== undefined) error.message += `. Did you mean "--${suggestion}"?`;
}

/** Report a command-not-found failure; loaded only when one occurs. */
export async function reportUnknownCommand(
	error: CrustError<"COMMAND_NOT_FOUND">,
	context: ExtensionContext,
	mode: "error" | "help",
	renderHelp: (
		command: CommandSnapshot,
		path: readonly string[],
		options: RenderHelpOptions,
	) => Promise<string>,
): Promise<true> {
	const details = error.details;
	const suggestion = findSuggestion(
		details.input,
		commandCandidates(details.parentCommand.subCommands),
	);

	let message = `Unknown command "${details.input}".`;
	if (suggestion !== undefined) {
		message += ` Did you mean "${suggestion}"?`;
	}

	if (mode === "help") {
		context.stdout(message);
		context.stdout("");
		context.stdout(
			await renderHelp(details.parentCommand, details.commandPath, {
				columns: context.stdout.columns,
			}),
		);
		return true;
	}

	if (details.available.length > 0) {
		message += `\n\nAvailable commands: ${details.available.join(", ")}`;
	}
	context.stderr(message);
	// Core preserves the nonzero exit code — rendering only here.
	return true;
}
