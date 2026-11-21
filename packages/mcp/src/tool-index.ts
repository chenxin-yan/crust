import type { CommandSnapshot } from "@crustjs/core";

import type { McpTool } from "./tools.ts";

/** A manifest entry with the snapshot of its command. */
export type ToolEntry = readonly [McpTool, CommandSnapshot];

/** A built index; see {@link createToolIndex}. */
export interface ToolIndex {
	/**
	 * Up to `limit` tools that match the words of `query`, best first, ties in
	 * command path order. Tools that match no word are left out.
	 */
	search(query: string, limit: number): readonly McpTool[];
}

// Command words outrank description words, which outrank argument and flag words.
const PATH_WEIGHT = 8;
const DESCRIPTION_WEIGHT = 2;
const INPUT_WEIGHT = 0.5;
// Fractions of an exact match: the same singular form (`keys` and `key`), or the start of a longer word.
const STEM_MATCH = 0.75;
const PREFIX_MATCH = 0.5;
// BM25's usual length normalization: 0 ignores a field's length, 1 divides by it relative to the average.
const LENGTH_NORMALIZATION = 0.75;

/** Strip a plural ending so `keys` and `key` match. */
function stem(word: string): string {
	if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
	if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
	return word;
}

/** Lowercased words; camelCase and any non-alphanumeric character split words. */
function words(text: string): string[] {
	return (
		text
			.replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
			.replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
			.toLowerCase()
			.match(/[\p{L}\p{N}]+/gu) ?? []
	);
}

/** The words of one indexed field, as written and in their singular forms. */
interface Field {
	readonly exact: ReadonlySet<string>;
	readonly stems: ReadonlySet<string>;
}

/** How well a query word matches one field: 1 exactly, then {@link STEM_MATCH}, then {@link PREFIX_MATCH}, else 0. */
function fieldMatch(field: Field, word: string, wordStem: string): number {
	if (field.exact.has(word)) return 1;
	if (field.stems.has(wordStem)) return STEM_MATCH;
	if (wordStem.length < 2) return 0;
	for (const candidate of field.stems) if (candidate.startsWith(wordStem)) return PREFIX_MATCH;
	return 0;
}

/**
 * Build the index `search_tools` ranks with. Indexed per tool: its command
 * path, `meta.name` and `meta.aliases`, its description, and the names and
 * descriptions of its arguments and of flags no Extension declares.
 *
 * A query word counts by BM25's inverse document frequency, so a word most
 * tools match (`a`, `for`, a group name every tool repeats) counts little and a
 * rare one counts much; and a match counts more in a field with fewer words
 * than the average, so a long generated name does not win by containing every
 * filler word of the query.
 *
 * shortcut: a linear scan with fixed field weights and plural-only stemming;
 * move to an inverted index if query time on large tool lists falls short.
 */
export function createToolIndex(entries: readonly ToolEntry[]): ToolIndex {
	// Generated commands repeat their texts (shared flags, templated descriptions), so split each text once.
	const split = new Map<string, readonly string[]>();
	const fieldOf = (texts: readonly (string | undefined)[]): Field => {
		const exact = new Set<string>();
		const stems = new Set<string>();
		for (const text of texts) {
			if (!text) continue;
			let found = split.get(text);
			if (found === undefined) split.set(text, (found = words(text)));
			for (const word of found) {
				exact.add(word);
				stems.add(stem(word));
			}
		}
		return { exact, stems };
	};
	const fieldsOf = ([tool, command]: ToolEntry) =>
		[
			[PATH_WEIGHT, fieldOf([...tool.path, command.meta.name, ...(command.meta.aliases ?? [])])],
			[DESCRIPTION_WEIGHT, fieldOf([command.meta.description])],
			[
				INPUT_WEIGHT,
				fieldOf([
					...command.args.flatMap((arg) => [arg.name, arg.description]),
					...Object.entries(command.flags).flatMap(([name, flag]) =>
						flag.extension === undefined ? [name, flag.description] : [],
					),
				]),
			],
		] as const;
	const fieldLists = entries.map(fieldsOf);
	// Per field kind; an empty field never matches, so 1 stands in for an average of 0.
	const averageSize = [0, 1, 2].map(
		(at) =>
			fieldLists.reduce((sum, fields) => sum + fields[at]![1].exact.size, 0) / entries.length || 1,
	);
	const indexed = entries.map(([tool], at) => ({
		tool,
		key: tool.path.join(" "),
		// Each field's weight, lowered for a field with more words than average and raised for one with fewer.
		fields: fieldLists[at]!.map(([weight, field], kind) => {
			const relativeSize = field.exact.size / averageSize[kind]!;
			return [
				weight / (1 - LENGTH_NORMALIZATION + LENGTH_NORMALIZATION * relativeSize),
				field,
			] as const;
		}),
	}));
	return {
		search(query, limit) {
			const queryWords = [...new Set(words(query))].map((word) => [word, stem(word)] as const);
			const matches = indexed.map((entry) =>
				queryWords.map(([word, wordStem]) =>
					entry.fields.reduce(
						(sum, [weight, field]) => sum + weight * fieldMatch(field, word, wordStem),
						0,
					),
				),
			);
			const rarity = queryWords.map((_, at) => {
				const matching = matches.filter((match) => match[at]! > 0).length;
				return Math.log(1 + (indexed.length - matching + 0.5) / (matching + 0.5));
			});
			return indexed
				.map((entry, at) => ({
					entry,
					score: matches[at]!.reduce((sum, match, word) => sum + match * rarity[word]!, 0),
				}))
				.filter(({ score }) => score > 0)
				.sort(
					(a, b) =>
						b.score - a.score ||
						(a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0),
				)
				.slice(0, limit)
				.map(({ entry }) => entry.tool);
		},
	};
}
