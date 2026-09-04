import type { FuzzyFilterResult } from "./fuzzy.ts";
import { fuzzyFilter } from "./fuzzy.ts";
import type { PromptIO } from "./renderer.ts";
import { resolveShortCircuit } from "./shortCircuit.ts";
import type { Choice } from "./types.ts";
import type { NormalizedChoice } from "./utils.ts";
import { calculateScrollOffset, DEFAULT_MAX_VISIBLE, normalizeChoices } from "./utils.ts";

interface ListPromptOptions<T, Answer extends T | readonly T[]> {
	readonly choices: readonly Choice<T>[];
	readonly initial?: Answer;
	readonly default?: Answer;
	readonly maxVisible?: number;
}

type ListPromptSetup<T, Answer extends T | readonly T[]> =
	| { readonly shortCircuited: true; readonly value: Answer }
	| {
			readonly shortCircuited: false;
			readonly choices: readonly NormalizedChoice<T>[];
			readonly maxVisible: number;
			readonly cursor: number;
			readonly scrollOffset: number;
			readonly selected: ReadonlySet<number>;
			readonly promptIO: Required<PromptIO>;
	  };

/** @internal Resolve the shared lifecycle and initial viewport for list prompts. */
export async function setupListPrompt<T, Answer extends T | readonly T[]>(
	options: ListPromptOptions<T, Answer>,
	mode: "single" | "multiple",
	io?: PromptIO,
): Promise<ListPromptSetup<T, Answer>> {
	const shortCircuit = await resolveShortCircuit(options, io);
	if (shortCircuit.shortCircuited) return shortCircuit;

	const choices = normalizeChoices(options.choices);
	const maxVisible = options.maxVisible ?? DEFAULT_MAX_VISIBLE;
	// SAFETY: The explicit mode disambiguates scalar array-valued T from multi-answer T[].
	const defaults: readonly T[] =
		options.default === undefined
			? []
			: mode === "multiple"
				? (options.default as readonly T[])
				: [options.default as T];
	const selected = new Set(
		defaults
			.map((value) => choices.findIndex((choice) => choice.value === value))
			.filter((index) => index !== -1),
	);
	const defaultCursor =
		defaults.length === 0 ? -1 : choices.findIndex((choice) => choice.value === defaults[0]);
	const cursor = defaultCursor === -1 ? 0 : defaultCursor;

	return {
		shortCircuited: false,
		choices,
		maxVisible,
		cursor,
		scrollOffset: calculateScrollOffset(cursor, 0, choices.length, maxVisible),
		selected,
		promptIO: shortCircuit.promptIO,
	};
}

/** @internal Re-filter a list prompt after its query changes. */
export function refilter<
	T,
	S extends {
		readonly query: string;
		readonly choices: readonly { readonly label: string; readonly value: T }[];
	},
>(
	state: S,
	maxVisible: number,
): S & {
	readonly results: FuzzyFilterResult<T>[];
	readonly listCursor: number;
	readonly scrollOffset: number;
} {
	const results = fuzzyFilter(state.query, state.choices);
	const listCursor = 0;
	const scrollOffset = calculateScrollOffset(listCursor, 0, results.length, maxVisible);
	return { ...state, results, listCursor, scrollOffset };
}
