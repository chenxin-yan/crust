// ────────────────────────────────────────────────────────────────────────────
// Create Style — Configurable style instance factory
// ────────────────────────────────────────────────────────────────────────────

import type { AnsiPair } from "./ansiCodes.ts";
import {
	resolveColorCapability,
	resolveHyperlinkCapability,
	resolveModifierCapability,
	resolveTrueColorCapability,
} from "./capability.ts";
import {
	bgHex as bgHexDirect,
	bgRgb as bgRgbDirect,
	hex as hexDirect,
	rgb as rgbDirect,
} from "./dynamicColors.ts";
import { link as linkDirect } from "./hyperlinks.ts";
import { applyStyle } from "./styleEngine.ts";
import {
	isModifierName,
	isModifierPair,
	styleMethodNames,
	stylePairFor,
} from "./styleMethodRegistry.ts";
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
		if (isModifierName(methodName) ? !modifiersEnabled : !colorsEnabled) {
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
	const colorsEnabled = resolveColorCapability(mode, options?.overrides);
	const hyperlinksEnabled = resolveHyperlinkCapability(
		mode,
		options?.overrides,
	);
	const enabled = modifiersEnabled || colorsEnabled;
	const trueColorEnabled = resolveTrueColorCapability(mode, options?.overrides);
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

		apply: (text: string, pair: AnsiPair) => {
			// Registered modifier pairs are gated on `modifiersEnabled` so
			// they survive `NO_COLOR` (which only disables colors). Color
			// pairs — and any ad-hoc pair constructed outside the registry
			// — fall through to `colorsEnabled`.
			const gate = isModifierPair(pair) ? modifiersEnabled : colorsEnabled;
			return gate ? applyStyle(text, pair) : text;
		},

		link: hyperlinksEnabled
			? (text: string, url: string, hyperlinkOptions) =>
					linkDirect(text, url, hyperlinkOptions)
			: (text: string, _url: string) => text,

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

// Runtime style cache keyed on `(globalMode, isTTY, NO_COLOR)`. The
// `"never"` override intentionally maps to an `auto` instance with
// `noColor: "1"` so that modifiers (bold, italic, etc.) remain enabled —
// matching the no-color.org semantics for `--no-color` without also
// suppressing non-color ANSI.
const runtimeStyleCache = new Map<string, StyleInstance>();

function buildRuntimeStyle(): StyleInstance {
	if (globalColorMode === "always") {
		return createStyle({ mode: "always" });
	}
	if (globalColorMode === "never") {
		return createStyle({
			mode: "auto",
			overrides: { isTTY: true, noColor: "1" },
		});
	}
	return createStyle({ mode: "auto" });
}

export function getRuntimeStyle(): StyleInstance {
	const key = `${globalColorMode ?? "auto"}|${process.stdout?.isTTY ?? false}|${process.env.NO_COLOR ?? ""}`;
	const cached = runtimeStyleCache.get(key);
	if (cached) {
		return cached;
	}
	const built = buildRuntimeStyle();
	runtimeStyleCache.set(key, built);
	return built;
}

// Members whose implementation is a function and must be forwarded as a
// bound method so callers can invoke them like `style.apply(...)`.
const FORWARDED_METHODS = [
	"apply",
	"link",
	"rgb",
	"bgRgb",
	"hex",
	"bgHex",
] as const;

// Members that read a value off the current runtime style on every access.
const FORWARDED_GETTERS = [
	"enabled",
	"colorsEnabled",
	"trueColorEnabled",
] as const;

function createRuntimeStyleFacade(): StyleInstance {
	const facade = {} as StyleInstance;

	for (const key of FORWARDED_GETTERS) {
		Object.defineProperty(facade, key, {
			configurable: false,
			enumerable: true,
			get() {
				return getRuntimeStyle()[key];
			},
		});
	}

	for (const key of FORWARDED_METHODS) {
		Object.defineProperty(facade, key, {
			configurable: false,
			enumerable: true,
			value: (...args: unknown[]) => {
				// biome-ignore lint/suspicious/noExplicitAny: dynamic forwarding preserves the runtime instance signature
				return (getRuntimeStyle()[key] as any)(...args);
			},
			writable: false,
		});
	}

	for (const name of styleMethodNames) {
		Object.defineProperty(facade, name, {
			configurable: false,
			enumerable: true,
			get() {
				return getRuntimeStyle()[name];
			},
		});
	}

	return Object.freeze(facade);
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
