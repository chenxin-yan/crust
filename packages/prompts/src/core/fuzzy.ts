// ────────────────────────────────────────────────────────────────────────────
// Fuzzy — Fuzzy matching algorithm for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { PromptTheme } from "./types.ts";

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
export interface FuzzyFilterResult<
	T,
	Item extends { readonly label: string; readonly value: T } = {
		readonly label: string;
		readonly value: T;
	},
> {
	/** The original item, with its full type (e.g. a choice's `hint`) */
	readonly item: Item;
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

	return matchLowered(query.toLowerCase(), candidate);
}

/** Score for a query character matched at `lowerIdx` of the lowercased candidate. */
function matchScore(
	candidate: string,
	lowerIdx: number,
	candIdx: number,
	prevMatchIdx: number,
	startsChar: boolean,
): number {
	let score = MATCH_SCORE;
	// Consecutive match bonus
	if (lowerIdx === prevMatchIdx + 1) score += CONSECUTIVE_BONUS;
	// Start-of-string bonus
	if (lowerIdx === 0) score += START_BONUS;
	// Word boundary bonus (character after a separator), read from the original label
	if (startsChar && candIdx > 0) {
		const prevChar = candidate[candIdx - 1];
		if (prevChar === " " || prevChar === "-" || prevChar === "_" || prevChar === ".") {
			score += WORD_BOUNDARY_BONUS;
		}
	}
	return score;
}

/** Match an already-lowercased, non-empty query so filtering normalizes it once per pass. */
function matchLowered(queryLower: string, candidate: string): FuzzyMatchResult {
	const indices: number[] = [];
	let score = 0;
	let queryIdx = 0;
	let prevMatchIdx = -2; // -2 so first match isn't falsely consecutive
	// ASCII lowercases 1:1 and context-free, so ASCII labels need neither a lowered
	// copy nor the code-point walk. This runs per candidate on every filter keystroke.
	for (let i = 0; i < candidate.length && queryIdx < queryLower.length; i++) {
		let code = candidate.charCodeAt(i);
		if (code >= 0x80) return matchUnicode(queryLower, candidate);
		if (code >= 0x41 && code <= 0x5a) code += 0x20;
		if (code !== queryLower.charCodeAt(queryIdx)) continue;
		score += matchScore(candidate, i, i, prevMatchIdx, true);
		indices.push(i);
		prevMatchIdx = i;
		queryIdx++;
	}
	return queryIdx < queryLower.length
		? { match: false, score: 0, indices: [] }
		: { match: true, score, indices };
}

function matchUnicode(queryLower: string, candidate: string): FuzzyMatchResult {
	const indices: number[] = [];
	let score = 0;
	let queryIdx = 0;
	let prevMatchIdx = -2;
	// Compare against the whole lowercased string (context-sensitive, e.g. final
	// sigma, like the query), but walk original code points so indices map back:
	// lowercasing can change length (e.g. "İ" → "i̇").
	const candidateLower = candidate.toLowerCase();
	let lowerIdx = 0; // offset into `candidateLower`
	let candIdx = 0; // offset of the current code point in the original candidate
	while (candIdx < candidate.length && queryIdx < queryLower.length) {
		const code = candidate.codePointAt(candIdx) ?? 0;
		const charLength = code > 0xffff ? 2 : 1;
		// Mapping length is context-free even where the mapping itself is not; ASCII maps 1:1.
		const lowerLength =
			code < 0x80 ? 1 : candidate.slice(candIdx, candIdx + charLength).toLowerCase().length;
		let charMatched = false;

		for (let k = 0; k < lowerLength && queryIdx < queryLower.length; k++, lowerIdx++) {
			if (candidateLower[lowerIdx] !== queryLower[queryIdx]) continue;
			score += matchScore(candidate, lowerIdx, candIdx, prevMatchIdx, k === 0);
			if (!charMatched) {
				for (let unit = 0; unit < charLength; unit++) indices.push(candIdx + unit);
				charMatched = true;
			}
			prevMatchIdx = lowerIdx;
			queryIdx++;
		}

		candIdx += charLength;
	}

	return queryIdx < queryLower.length
		? { match: false, score: 0, indices: [] }
		: { match: true, score, indices };
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
 * @returns Matched items, as the same objects passed in, sorted by score (highest first)
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
export function fuzzyFilter<
	T,
	Item extends { readonly label: string; readonly value: T } = {
		readonly label: string;
		readonly value: T;
	},
>(query: string, items: readonly Item[]): FuzzyFilterResult<T, Item>[] {
	if (query.length === 0) {
		return items.map((item) => ({ item, score: 0, indices: [] }));
	}

	const queryLower = query.toLowerCase();
	const results: FuzzyFilterResult<T, Item>[] = [];

	for (const item of items) {
		const result = matchLowered(queryLower, item.label);
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

/** Apply the filter-match style to matched runs in a label. */
export function highlightMatches(
	label: string,
	indices: readonly number[],
	theme: PromptTheme,
): string {
	if (indices.length === 0) return label;

	const indexSet = new Set(indices);
	let result = "";
	let i = 0;

	while (i < label.length) {
		if (indexSet.has(i)) {
			let matchedChars = "";
			while (i < label.length && indexSet.has(i)) {
				matchedChars += label[i];
				i++;
			}
			result += theme.filterMatch(matchedChars);
		} else {
			result += label[i];
			i++;
		}
	}

	return result;
}
