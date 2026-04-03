// ────────────────────────────────────────────────────────────────────────────
// Create Style — Configurable style instance factory
// ────────────────────────────────────────────────────────────────────────────

import type { AnsiPair } from "./ansiCodes.ts";
import {
	resolveCapability,
	resolveModifierCapability,
	resolveTrueColor,
} from "./capability.ts";
import {
	bgHex as bgHexDirect,
	bgRgb as bgRgbDirect,
	hex as hexDirect,
	rgb as rgbDirect,
} from "./dynamicColors.ts";
import { applyStyle } from "./styleEngine.ts";
import { styleMethodNames, stylePairFor } from "./styleMethodRegistry.ts";
import type {
	ChainableStyleFn,
	ColorMode,
	StyleInstance,
	StyleMethodMap,
	StyleMethodName,
	StyleOptions,
} from "./types.ts";

function applyChain(
	text: string,
	methodNames: readonly StyleMethodName[],
	modifiersEnabled: boolean,
	colorsEnabled: boolean,
): string {
	if (text === "") {
		return text;
	}

	let result = text;
	for (let i = methodNames.length - 1; i >= 0; i--) {
		const methodName = methodNames[i];
		if (methodName === undefined) {
			continue;
		}
		const isModifier =
			methodName === "bold" ||
			methodName === "dim" ||
			methodName === "italic" ||
			methodName === "underline" ||
			methodName === "inverse" ||
			methodName === "hidden" ||
			methodName === "strikethrough";
		if (isModifier ? !modifiersEnabled : !colorsEnabled) {
			continue;
		}
		result = applyStyle(result, stylePairFor(methodName));
	}

	return result;
}

function buildChainableStyleFactory(
	modifiersEnabled: boolean,
	colorsEnabled: boolean,
) {
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
			applyChain(
				text,
				methodNames,
				modifiersEnabled,
				colorsEnabled,
			)) as ChainableStyleFn;

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
 * and background color functions. In `"never"` mode, all functions return
 * plain text without ANSI codes. In `"always"` mode, ANSI codes are always
 * emitted. In `"auto"` mode, color methods respect `stdout.isTTY` and
 * `NO_COLOR`, while non-color modifiers (bold, italic, etc.) are always
 * emitted.
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
	const modifiersEnabled = resolveModifierCapability(mode, options?.overrides);
	const colorsEnabled = resolveCapability(mode, options?.overrides);
	const enabled = modifiersEnabled || colorsEnabled;
	const trueColorEnabled = resolveTrueColor(mode, options?.overrides);
	const createChainableStyle = buildChainableStyleFactory(
		modifiersEnabled,
		colorsEnabled,
	);
	const methods = buildStyleMethods(createChainableStyle);

	const instance: StyleInstance = {
		enabled,
		colorsEnabled,
		trueColorEnabled,

		// ── Style engine ────────────────────────────────────────────────────

		apply: colorsEnabled
			? (text: string, pair: AnsiPair) => applyStyle(text, pair)
			: (text: string, _pair: AnsiPair) => text,

		// ── Dynamic colors (truecolor) ──────────────────────────────────────

		rgb: trueColorEnabled
			? (text: string, r: number, g: number, b: number) =>
					rgbDirect(text, r, g, b)
			: (text: string, _r: number, _g: number, _b: number) => text,

		bgRgb: trueColorEnabled
			? (text: string, r: number, g: number, b: number) =>
					bgRgbDirect(text, r, g, b)
			: (text: string, _r: number, _g: number, _b: number) => text,

		hex: trueColorEnabled
			? (text: string, hexColor: string) => hexDirect(text, hexColor)
			: (text: string, _hexColor: string) => text,

		bgHex: trueColorEnabled
			? (text: string, hexColor: string) => bgHexDirect(text, hexColor)
			: (text: string, _hexColor: string) => text,

		...methods,
	};

	return Object.freeze(instance);
}

let globalColorMode: ColorMode | undefined;

export function setGlobalColorMode(mode: ColorMode | undefined): void {
	globalColorMode = mode;
}

export function getGlobalColorMode(): ColorMode | undefined {
	return globalColorMode;
}

const alwaysRuntimeStyle = createStyle({ mode: "always" });
const noColorRuntimeStyle = createStyle({
	mode: "auto",
	overrides: {
		isTTY: true,
		noColor: "1",
	},
});

let cachedAutoKey: string | undefined;
let cachedAutoStyle: StyleInstance | undefined;

export function getRuntimeStyle(): StyleInstance {
	if (globalColorMode === "always") {
		return alwaysRuntimeStyle;
	}

	if (globalColorMode === "never") {
		return noColorRuntimeStyle;
	}

	const isTTY = process.stdout?.isTTY ?? false;
	const noColor = process.env.NO_COLOR;
	const key = `${isTTY}|${noColor}`;
	if (cachedAutoKey === key && cachedAutoStyle) {
		return cachedAutoStyle;
	}
	cachedAutoStyle = createStyle({ mode: "auto" });
	cachedAutoKey = key;
	return cachedAutoStyle;
}

function createRuntimeStyleFacade(): StyleInstance {
	const facade: Partial<StyleInstance> = {
		get enabled() {
			return getRuntimeStyle().enabled;
		},
		get colorsEnabled() {
			return getRuntimeStyle().colorsEnabled;
		},
		get trueColorEnabled() {
			return getRuntimeStyle().trueColorEnabled;
		},
		apply(text: string, pair: AnsiPair) {
			return getRuntimeStyle().apply(text, pair);
		},
		rgb(text: string, r: number, g: number, b: number) {
			return getRuntimeStyle().rgb(text, r, g, b);
		},
		bgRgb(text: string, r: number, g: number, b: number) {
			return getRuntimeStyle().bgRgb(text, r, g, b);
		},
		hex(text: string, hexColor: string) {
			return getRuntimeStyle().hex(text, hexColor);
		},
		bgHex(text: string, hexColor: string) {
			return getRuntimeStyle().bgHex(text, hexColor);
		},
	};

	for (const methodName of styleMethodNames) {
		Object.defineProperty(facade, methodName, {
			configurable: false,
			enumerable: true,
			get() {
				return getRuntimeStyle()[methodName];
			},
		});
	}

	return Object.freeze(facade as StyleInstance);
}

/**
 * Default style instance using `"auto"` mode.
 *
 * Emits color ANSI codes when stdout is a TTY and `NO_COLOR` is not set.
 * Non-color modifiers (bold, italic, etc.) are always emitted.
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
export const style: StyleInstance = createRuntimeStyleFacade();
