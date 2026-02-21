// ────────────────────────────────────────────────────────────────────────────
// Create Style — Configurable style instance factory
// ────────────────────────────────────────────────────────────────────────────

import type { AnsiPair } from "./ansiCodes.ts";
import { resolveCapability } from "./capability.ts";
import { applyStyle } from "./styleEngine.ts";
import { styleMethodNames, stylePairFor } from "./styleMethodRegistry.ts";
import type {
	ChainableStyleFn,
	StyleInstance,
	StyleMethodMap,
	StyleMethodName,
	StyleOptions,
} from "./types.ts";

function applyChain(
	text: string,
	methodNames: readonly StyleMethodName[],
	enabled: boolean,
): string {
	if (!enabled || text === "") {
		return text;
	}

	let result = text;
	for (let i = methodNames.length - 1; i >= 0; i--) {
		const methodName = methodNames[i];
		if (methodName === undefined) {
			continue;
		}
		result = applyStyle(result, stylePairFor(methodName));
	}

	return result;
}

function buildChainableStyleFactory(enabled: boolean) {
	const cache = new Map<string, ChainableStyleFn>();

	function makeKey(methodNames: readonly StyleMethodName[]): string {
		return methodNames.join("|");
	}

	function createChainableStyle(
		methodNames: readonly StyleMethodName[],
	): ChainableStyleFn {
		const key = makeKey(methodNames);
		const cached = cache.get(key);
		if (cached) {
			return cached;
		}

		const styleFn = ((text: string) =>
			applyChain(text, methodNames, enabled)) as ChainableStyleFn;

		cache.set(key, styleFn);

		for (const name of styleMethodNames) {
			Object.defineProperty(styleFn, name, {
				configurable: false,
				enumerable: true,
				get() {
					return createChainableStyle([...methodNames, name]);
				},
			});
		}

		return Object.freeze(styleFn);
	}

	return createChainableStyle;
}

function buildStyleMethods(
	createChainableStyle: (
		methodNames: readonly StyleMethodName[],
	) => ChainableStyleFn,
): StyleMethodMap {
	const methods = {} as { [K in StyleMethodName]: ChainableStyleFn };

	for (const methodName of styleMethodNames) {
		methods[methodName] = createChainableStyle([methodName]);
	}

	return methods;
}

/**
 * Create a configured style instance with mode-aware styling functions.
 *
 * The returned instance provides the full set of modifier, foreground color,
 * and background color functions. In `"never"` mode (or when `"auto"` mode
 * resolves to disabled), all functions return plain text without ANSI codes.
 * In `"always"` mode (or when `"auto"` resolves to enabled), ANSI codes are
 * emitted via the nesting-safe style engine.
 *
 * @param options - Configuration options. Defaults to `{ mode: "auto" }`.
 * @returns A frozen {@link StyleInstance} with all styling functions.
 *
 * @example
 * ```ts
 * // Auto-detect terminal capabilities
 * const s = createStyle();
 * console.log(s.bold("hello"));
 *
 * // Force color output
 * const color = createStyle({ mode: "always" });
 * console.log(color.red("error"));
 * console.log(color.bold.red("critical"));
 *
 * // Disable all styling
 * const plain = createStyle({ mode: "never" });
 * console.log(plain.red("error")); // "error"
 *
 * // Deterministic testing
 * const test = createStyle({
 *   mode: "auto",
 *   overrides: { isTTY: true, noColor: undefined },
 * });
 * ```
 */
export function createStyle(options?: StyleOptions): StyleInstance {
	const mode = options?.mode ?? "auto";
	const enabled = resolveCapability(mode, options?.overrides);
	const createChainableStyle = buildChainableStyleFactory(enabled);
	const methods = buildStyleMethods(createChainableStyle);

	const instance: StyleInstance = {
		enabled,

		// ── Style engine ────────────────────────────────────────────────────

		apply: enabled
			? (text: string, pair: AnsiPair) => applyStyle(text, pair)
			: (text: string, _pair: AnsiPair) => text,

		...methods,
	};

	return Object.freeze(instance);
}

/**
 * Default style instance using `"auto"` mode.
 *
 * Emits ANSI codes when stdout is a TTY and `NO_COLOR` is not set.
 * Import this for convenient access without explicit configuration.
 *
 * @example
 * ```ts
 * import { style } from "@crustjs/style";
 *
 * console.log(style.bold("hello"));
 * console.log(style.red("error"));
 * ```
 */
export const style: StyleInstance = createStyle();
