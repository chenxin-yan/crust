import { CrustError } from "../errors.ts";
import type { CrustPlugin } from "../plugins.ts";
import { renderHelp } from "./help.ts";

export interface AutoCompletePluginOptions {
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

function findSuggestions(input: string, candidates: string[]): string[] {
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

	return suggestions.map((suggestion) => suggestion.name);
}

export function autoCompletePlugin(
	options: AutoCompletePluginOptions = {},
): CrustPlugin {
	const mode = options.mode ?? "error";

	return {
		name: "autocomplete",
		async middleware(_context, next) {
			try {
				await next();
				return;
			} catch (error) {
				if (!(error instanceof CrustError)) throw error;
				if (!error.is("COMMAND_NOT_FOUND")) throw error;

				const details = error.details;
				const suggestions = findSuggestions(details.input, details.available);

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
