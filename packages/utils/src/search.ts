/** The texts of one searchable item, by weight class. `undefined` entries are skipped. */
export interface SearchItem {
	/** Weighs most, e.g. a command's path, name, and aliases. */
	readonly names: readonly (string | undefined)[];
	/** Weighs less, e.g. a command's description. */
	readonly descriptions: readonly (string | undefined)[];
	/** Weighs least, e.g. argument and flag names and descriptions. */
	readonly details: readonly (string | undefined)[];
}

/**
 * Indexes of up to `limit` items that match the words of `query`, best first,
 * ties in item order. Items that match no word are left out.
 */
export type SearchIndex = (query: string, limit: number) => readonly number[];

// Name words outrank description words, which outrank detail words.
const NAME_WEIGHT = 8;
const DESCRIPTION_WEIGHT = 2;
const DETAIL_WEIGHT = 0.5;
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

/** The words of one field of an item, as written and in their singular forms. */
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
 * Build a word search over `items`. Words match without case and split at
 * camelCase: as written first, then in their singular form, then by prefix.
 *
 * A query word counts by BM25's inverse document frequency, so a word most
 * items match (`a`, `for`, a group name every item repeats) counts little and
 * a rare one counts much; and a match counts more in a field with fewer words
 * than the average, so a long name does not win by containing every filler
 * word of the query. Scores therefore depend on the whole item list.
 *
 * shortcut: a linear scan with fixed field weights and plural-only stemming;
 * move to an inverted index if query time on large item lists falls short.
 */
export function createSearchIndex(items: readonly SearchItem[]): SearchIndex {
	// Generated items repeat their texts (shared flags, templated descriptions), so split each text once.
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
	const fieldLists = items.map(
		(item) =>
			[
				[NAME_WEIGHT, fieldOf(item.names)],
				[DESCRIPTION_WEIGHT, fieldOf(item.descriptions)],
				[DETAIL_WEIGHT, fieldOf(item.details)],
			] as const,
	);
	// Per weight class; an empty field never matches, so 1 stands in for an average of 0.
	const averageSize = [0, 1, 2].map(
		(at) =>
			fieldLists.reduce((sum, fields) => sum + fields[at]![1].exact.size, 0) / items.length || 1,
	);
	// Each field's weight, lowered for a field with more words than average and raised for one with fewer.
	const indexed = fieldLists.map((fields) =>
		fields.map(([weight, field], kind) => {
			const relativeSize = field.exact.size / averageSize[kind]!;
			return [
				weight / (1 - LENGTH_NORMALIZATION + LENGTH_NORMALIZATION * relativeSize),
				field,
			] as const;
		}),
	);
	return (query, limit) => {
		const queryWords = [...new Set(words(query))].map((word) => [word, stem(word)] as const);
		const matches = indexed.map((fields) =>
			queryWords.map(([word, wordStem]) =>
				fields.reduce(
					(sum, [weight, field]) => sum + weight * fieldMatch(field, word, wordStem),
					0,
				),
			),
		);
		const rarity = queryWords.map((_, at) => {
			const matching = matches.filter((match) => match[at]! > 0).length;
			return Math.log(1 + (indexed.length - matching + 0.5) / (matching + 0.5));
		});
		return matches
			.map((match, item) => ({
				item,
				score: match.reduce((sum, value, word) => sum + value * rarity[word]!, 0),
			}))
			.filter(({ score }) => score > 0)
			.sort((a, b) => b.score - a.score || a.item - b.item)
			.slice(0, limit)
			.map(({ item }) => item);
	};
}
