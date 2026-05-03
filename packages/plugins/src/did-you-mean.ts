import type { CommandNode, CrustPlugin } from "@crustjs/core";
import { CrustError } from "@crustjs/core";
import { renderHelp } from "./help.ts";

export interface DidYouMeanPluginOptions {
	mode?: "error" | "help";
}

function levenshtein(a: string, b: string): number {
	const aLen = a.length;
	const bLen = b.length;

	if (aLen === 0) return bLen;
	if (bLen === 0) return aLen;

	const row: number[] = Array.from({ length: bLen + 1 }, (_, i) => i);

	for (let i = 1; i <= aLen; i++) {
		let prev = i;
		for (let j = 1; j <= bLen; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const val = Math.min(
				(row[j] as number) + 1,
				prev + 1,
				(row[j - 1] as number) + cost,
			);
			row[j - 1] = prev;
			prev = val;
		}
		row[bLen] = prev;
	}

	return row[bLen] as number;
}

/**
 * Build an alias→canonical lookup table from a parent command's `subCommands`
 * map. Canonical names map to themselves so callers can resolve any candidate
 * with a single `aliasMap.get(candidate)` call.
 */
function buildAliasMap(
	subCommands: Record<string, CommandNode>,
): Map<string, string> {
	const map = new Map<string, string>();
	for (const [name, node] of Object.entries(subCommands)) {
		map.set(name, name);
		const aliases = node.meta.aliases;
		if (aliases) {
			for (const alias of aliases) {
				// If a misconfigured tree somehow has an alias collision, the
				// first occurrence wins. Registration-time validation should
				// have already rejected this, but the resolver also prefers
				// canonical names (router.ts), so we mirror that here.
				if (!map.has(alias)) map.set(alias, name);
			}
		}
	}
	return map;
}

/**
 * Find candidate suggestions for `input` and return the **canonical** names
 * of the matched candidates (mapping aliases back via `aliasMap`). Order:
 * by ascending Levenshtein distance, then by name. Duplicates that arise
 * from an alias and its canonical both falling under the threshold are
 * collapsed (the first occurrence — i.e. the closer match — wins).
 */
function findSuggestions(
	input: string,
	candidates: string[],
	aliasMap: Map<string, string>,
): string[] {
	const suggestions: { name: string; distance: number }[] = [];

	for (const candidate of candidates) {
		if (candidate.startsWith(input) || input.startsWith(candidate)) {
			suggestions.push({ name: candidate, distance: 0 });
			continue;
		}

		const distance = levenshtein(input, candidate);
		if (distance <= 3) {
			suggestions.push({ name: candidate, distance });
		}
	}

	suggestions.sort((a, b) => {
		if (a.distance !== b.distance) return a.distance - b.distance;
		return a.name.localeCompare(b.name);
	});

	// Map every match back to its canonical name and dedupe while preserving
	// the (distance, name) order. Reporting canonicals only avoids
	// suggesting two strings that resolve to the same command (which would
	// be confusing) and matches the contract documented on `CommandMeta.aliases`.
	const seen = new Set<string>();
	const out: string[] = [];
	for (const { name } of suggestions) {
		const canonical = aliasMap.get(name) ?? name;
		if (seen.has(canonical)) continue;
		seen.add(canonical);
		out.push(canonical);
	}
	return out;
}

export function didYouMeanPlugin(
	options: DidYouMeanPluginOptions = {},
): CrustPlugin {
	const mode = options.mode ?? "error";

	return {
		name: "did-you-mean",
		async middleware(_context, next) {
			try {
				await next();
				return;
			} catch (error) {
				if (!(error instanceof CrustError)) throw error;
				if (!error.is("COMMAND_NOT_FOUND")) throw error;

				const details = error.details;
				const aliasMap = buildAliasMap(details.parentCommand.subCommands);
				const suggestions = findSuggestions(
					details.input,
					details.available,
					aliasMap,
				);

				let message = `Unknown command "${details.input}".`;
				if (suggestions.length > 0) {
					message += ` Did you mean "${suggestions[0]}"?`;
				}

				if (mode === "help") {
					console.log(message);
					console.log("");
					console.log(renderHelp(details.parentCommand, details.commandPath));
					return;
				}

				if (details.available.length > 0) {
					message += `\n\nAvailable commands: ${details.available.join(", ")}`;
				}
				console.error(message);
				process.exitCode = 1;
			}
		},
	};
}
