import type { FuzzyFilterResult } from "./fuzzy.ts";
import { fuzzyFilter } from "./fuzzy.ts";
import type { PromptIO } from "./renderer.ts";
import { isTTY, resolvePromptIO } from "./renderer.ts";
import type { Choice } from "./types.ts";
import type { NormalizedChoice } from "./utils.ts";
import { calculateScrollOffset, DEFAULT_MAX_VISIBLE, normalizeChoices } from "./utils.ts";

interface ListPromptOptions<T, Answer> {
	readonly choices: readonly Choice<T>[];
	readonly initial?: Answer;
	readonly default?: Answer;
	readonly maxVisible?: number;
}

type ListPromptSetup<T, Answer> =
	| { readonly shortCircuited: true; readonly value: Answer }
	| {
			readonly shortCircuited: false;
			readonly choices: readonly NormalizedChoice<T>[];
			readonly maxVisible: number;
			readonly cursor: number;
			readonly scrollOffset: number;
			readonly promptIO: Required<PromptIO>;
	  };

/** @internal Resolve the shared lifecycle and initial viewport for list prompts. */
export function setupListPrompt<T, Answer>(
	options: ListPromptOptions<T, Answer>,
	io?: PromptIO,
	defaultCursorValue?: T,
	hasDefaultCursor: boolean = defaultCursorValue !== undefined,
): ListPromptSetup<T, Answer> {
	if (options.initial !== undefined) return { shortCircuited: true, value: options.initial };

	const promptIO = resolvePromptIO(io);
	if (!isTTY(promptIO.input) && options.default !== undefined) {
		return { shortCircuited: true, value: options.default };
	}

	const choices = normalizeChoices(options.choices);
	const maxVisible = options.maxVisible ?? DEFAULT_MAX_VISIBLE;
	const defaultCursor = hasDefaultCursor
		? choices.findIndex((choice) => choice.value === defaultCursorValue)
		: -1;
	const cursor = defaultCursor === -1 ? 0 : defaultCursor;

	return {
		shortCircuited: false,
		choices,
		maxVisible,
		cursor,
		scrollOffset: calculateScrollOffset(cursor, 0, choices.length, maxVisible),
		promptIO,
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
