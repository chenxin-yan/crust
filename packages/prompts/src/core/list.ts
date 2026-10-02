import type { FuzzyFilterResult } from "./fuzzy.ts";
import { fuzzyFilter } from "./fuzzy.ts";
import type { KeypressEvent, PromptIO } from "./renderer.ts";
import { resolveShortCircuit } from "./short-circuit.ts";
import { handleTextEdit } from "./text-edit.ts";
import type { Choice } from "./types.ts";
import type { NormalizedChoice } from "./utils.ts";
import {
	calculateScrollOffset,
	DEFAULT_MAX_VISIBLE,
	moveCursor,
	normalizeChoices,
} from "./utils.ts";

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
	defaults: readonly T[],
	io?: PromptIO,
): Promise<ListPromptSetup<T, Answer>> {
	const shortCircuit = await resolveShortCircuit(options, io);
	if (shortCircuit.shortCircuited) return shortCircuit;

	const choices = normalizeChoices(options.choices);
	const maxVisible = options.maxVisible ?? DEFAULT_MAX_VISIBLE;
	const selected = new Set(
		defaults.flatMap((value) => {
			const index = choices.findIndex((choice) => choice.value === value);
			return index === -1 ? [] : [index];
		}),
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

/**
 * @internal Handle result navigation and query editing for filter prompts.
 * Returns `null` for keys it does not handle.
 */
export function handleQueryListKey<
	T,
	S extends {
		readonly query: string;
		readonly cursorPos: number;
		readonly choices: readonly { readonly label: string; readonly value: T }[];
		readonly results: readonly FuzzyFilterResult<T>[];
		readonly listCursor: number;
		readonly scrollOffset: number;
	},
>(key: KeypressEvent, state: S, maxVisible: number): S | null {
	if (key.name === "up" || key.name === "down") {
		const delta = key.name === "up" ? -1 : 1;
		const moved = moveCursor(
			state.listCursor,
			state.results.length,
			delta,
			state.scrollOffset,
			maxVisible,
		);
		return { ...state, listCursor: moved.cursor, scrollOffset: moved.scrollOffset };
	}

	const edit = handleTextEdit(key, state.query, state.cursorPos);
	if (!edit) return null;
	const next = { ...state, query: edit.text, cursorPos: edit.cursorPos };
	// Re-filter only when the query text actually changed
	return edit.text === state.query ? next : refilter(next, maxVisible);
}
