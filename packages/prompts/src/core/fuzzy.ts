// ────────────────────────────────────────────────────────────────────────────
// Fuzzy — Fuzzy matching algorithm for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Result of a fuzzy match against a single candidate.
 */
export interface FuzzyMatchResult {
	/** Whether the candidate matches the query */
	readonly match: boolean;
	/** Match quality score — higher is better. 0 if no match. */
	readonly score: number;
	/** Indices of matched characters in the candidate string */
	readonly indices: readonly number[];
}

/**
 * A fuzzy-filtered item with its match metadata.
 */
export interface FuzzyFilterResult<T> {
	/** The original item */
	readonly item: { readonly label: string; readonly value: T };
	/** Match quality score */
	readonly score: number;
	/** Indices of matched characters in the label */
	readonly indices: readonly number[];
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/** Bonus for consecutive matched characters */
const CONSECUTIVE_BONUS = 5;

/** Bonus for matching at the start of the string */
const START_BONUS = 10;

/** Bonus for matching at a word boundary (after space, hyphen, underscore, etc.) */
const WORD_BOUNDARY_BONUS = 8;

/** Base score per matched character */
const MATCH_SCORE = 1;

// ────────────────────────────────────────────────────────────────────────────
// fuzzyMatch
// ────────────────────────────────────────────────────────────────────────────

/**
 * Test whether a query fuzzy-matches a candidate string.
 *
 * Each character in `query` must appear in `candidate` in order (but not
 * necessarily contiguously). Matching is case-insensitive.
 *
 * The score rewards:
 * - Consecutive matched characters (contiguity bonus)
 * - Matches at the start of the string
 * - Matches at word boundaries (after space, `-`, `_`, `.`)
 *
 * @param query - The search query
 * @param candidate - The string to match against
 * @returns Match result with boolean, score, and matched character indices
 *
 * @example
 * ```ts
 * fuzzyMatch("abc", "alphabet cookie"); // { match: true, score: ..., indices: [0, 9, 10] }
 * fuzzyMatch("xyz", "hello");           // { match: false, score: 0, indices: [] }
 * fuzzyMatch("", "anything");           // { match: true, score: 0, indices: [] }
 * ```
 */
export function fuzzyMatch(query: string, candidate: string): FuzzyMatchResult {
	// Empty query matches everything
	if (query.length === 0) {
		return { match: true, score: 0, indices: [] };
	}

	const queryLower = query.toLowerCase();
	const candidateLower = candidate.toLowerCase();

	const indices: number[] = [];
	let score = 0;
	let queryIdx = 0;
	let prevMatchIdx = -2; // -2 so first match isn't falsely consecutive

	for (
		let candIdx = 0;
		candIdx < candidateLower.length && queryIdx < queryLower.length;
		candIdx++
	) {
		if (candidateLower[candIdx] === queryLower[queryIdx]) {
			indices.push(candIdx);
			score += MATCH_SCORE;

			// Consecutive match bonus
			if (candIdx === prevMatchIdx + 1) {
				score += CONSECUTIVE_BONUS;
			}

			// Start-of-string bonus
			if (candIdx === 0) {
				score += START_BONUS;
			}

			// Word boundary bonus (character after a separator)
			if (candIdx > 0) {
				const prevChar = candidate[candIdx - 1];
				if (
					prevChar === " " ||
					prevChar === "-" ||
					prevChar === "_" ||
					prevChar === "."
				) {
					score += WORD_BOUNDARY_BONUS;
				}
			}

			prevMatchIdx = candIdx;
			queryIdx++;
		}
	}

	// All query characters must be matched
	if (queryIdx < queryLower.length) {
		return { match: false, score: 0, indices: [] };
	}

	return { match: true, score, indices };
}

// ────────────────────────────────────────────────────────────────────────────
// fuzzyFilter
// ────────────────────────────────────────────────────────────────────────────

/**
 * Filter and sort a list of labeled items by fuzzy-matching against a query.
 *
 * Returns only items that match, sorted by score descending (best matches first).
 * An empty query returns all items (each with score 0 and empty indices).
 *
 * @param query - The search query
 * @param items - Array of items with `label` and `value` properties
 * @returns Matched items sorted by score (highest first)
 *
 * @example
 * ```ts
 * const results = fuzzyFilter("ts", [
 *   { label: "TypeScript", value: "ts" },
 *   { label: "JavaScript", value: "js" },
 *   { label: "Rust", value: "rs" },
 * ]);
 * // Returns TypeScript and Rust (both contain "t" then "s")
 * ```
 */
export function fuzzyFilter<T>(
	query: string,
	items: readonly { readonly label: string; readonly value: T }[],
): FuzzyFilterResult<T>[] {
	if (query.length === 0) {
		return items.map((item) => ({ item, score: 0, indices: [] }));
	}

	const results: FuzzyFilterResult<T>[] = [];

	for (const item of items) {
		const result = fuzzyMatch(query, item.label);
		if (result.match) {
			results.push({
				item,
				score: result.score,
				indices: result.indices,
			});
		}
	}

	// Sort by score descending — higher scores first
	results.sort((a, b) => b.score - a.score);

	return results;
}
