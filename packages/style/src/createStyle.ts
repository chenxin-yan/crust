// ────────────────────────────────────────────────────────────────────────────
// Create Style — Configurable style instance factory
// ────────────────────────────────────────────────────────────────────────────

import type { AnsiPair } from "./ansiCodes.ts";
import {
	resolveColorDepth,
	resolveHyperlinkCapability,
	resolveModifierCapability,
} from "./capability.ts";
import { bg as bgDirect, bgPairAtDepth, fg as fgDirect, fgPairAtDepth } from "./color.ts";
import { linkCode, link as linkDirect } from "./hyperlinks.ts";
import { applyStyle } from "./styleEngine.ts";
import { isModifierName, styleMethodNames, stylePairFor } from "./styleMethodRegistry.ts";
import type {
	ChainableStyleFn,
	ColorDepth,
	ColorInput,
	StyleInstance,
	StyleMethodMap,
	StyleMethodName,
	StyleOptions,
} from "./types.ts";

// A single step in a chainable style. Either a registered method (looked
// up by name in the style registry) or an ad-hoc `AnsiPair` produced by a
// dynamic-color call like `style.bold.fg("#f00")`. The `isModifier` flag on
// pair-steps is `false` for dynamic colors (currently the only producers).
type ChainStep =
	| { readonly kind: "named"; readonly name: StyleMethodName }
	| {
			readonly kind: "pair";
			readonly pair: AnsiPair;
			readonly isModifier: boolean;
	  };

function stepIsModifier(step: ChainStep): boolean {
	return step.kind === "named" ? isModifierName(step.name) : step.isModifier;
}

function stepPair(step: ChainStep): AnsiPair {
	return step.kind === "named" ? stylePairFor(step.name) : step.pair;
}

interface ResolvedStyleCapabilities {
	readonly modifiersEnabled: boolean;
	readonly colorDepth: ColorDepth;
	readonly colorsEnabled: boolean;
	readonly trueColorEnabled: boolean;
	readonly hyperlinksEnabled: boolean;
}

function applyChain(
	text: string,
	steps: readonly ChainStep[],
	resolveCapabilities: () => ResolvedStyleCapabilities,
): string {
	// Defensive: nullish in → nullish out, never crash. JS callers passing
	// `undefined` previously hit `text.includes` and threw a TypeError; we
	// follow ansis here and return "".
	if (text == null) {
		return "";
	}
	if (typeof text !== "string") {
		text = String(text);
	}
	if (text === "") {
		return text;
	}

	const { modifiersEnabled, colorsEnabled } = resolveCapabilities();
	let result = text;
	for (let i = steps.length - 1; i >= 0; i--) {
		const step = steps[i];
		if (step === undefined) {
			continue;
		}
		if (stepIsModifier(step) ? !modifiersEnabled : !colorsEnabled) {
			continue;
		}
		result = applyStyle(result, stepPair(step));
	}

	return result;
}

function buildChainableStyleFactory(
	resolveCapabilities: () => ResolvedStyleCapabilities,
	runtime: boolean,
) {
	const cache = new Map<string, ChainableStyleFn>();

	function makeKey(
		steps: readonly ChainStep[],
		dynamic: boolean,
		capabilities?: ResolvedStyleCapabilities,
	): string {
		const mode = dynamic
			? "runtime"
			: `${capabilities?.modifiersEnabled}|${capabilities?.colorDepth}`;
		return `${mode}|${steps
			.map((step) => (step.kind === "named" ? step.name : `~${step.pair.open}`))
			.join("|")}`;
	}

	function createChainableStyle(
		steps: readonly ChainStep[],
		dynamic = runtime,
		capabilities?: ResolvedStyleCapabilities,
	): ChainableStyleFn {
		const fixedCapabilities = dynamic ? undefined : (capabilities ?? resolveCapabilities());
		const capabilitiesForCall = dynamic ? resolveCapabilities : () => fixedCapabilities!;
		const key = makeKey(steps, dynamic, fixedCapabilities);
		const cached = cache.get(key);
		if (cached) {
			return cached;
		}

		// Dispatcher: handles three call shapes
		//   chain(text)                          — direct
		//   chain`tagged ${value} template`      — tagged template
		//   chain(undefined | null)               — defensive (returns "")
		const styleFn = ((first?: string | TemplateStringsArray, ...rest: unknown[]) => {
			// Tagged template: first arg is a TemplateStringsArray (array-like
			// with a `.raw` property). Interleave with `${...}` values.
			if (
				Array.isArray(first) &&
				"raw" in (first as object) &&
				Array.isArray((first as { raw: unknown }).raw)
			) {
				const strings = first as unknown as TemplateStringsArray;
				let text = "";
				for (let i = 0; i < strings.length; i++) {
					text += strings[i] ?? "";
					if (i < rest.length) text += String(rest[i]);
				}
				return applyChain(text, steps, capabilitiesForCall);
			}
			return applyChain(first as string, steps, capabilitiesForCall);
		}) as ChainableStyleFn;

		cache.set(key, styleFn);

		// Registered chain methods (bold, red, bgYellow, ...)
		for (const name of styleMethodNames) {
			Object.defineProperty(styleFn, name, {
				configurable: false,
				enumerable: true,
				get() {
					return createChainableStyle(
						[...steps, { kind: "named", name }],
						false,
						capabilitiesForCall(),
					);
				},
			});
		}

		// Dynamic-color chain methods resolve depth when the chain is extended.
		Object.defineProperty(styleFn, "fg", {
			configurable: false,
			enumerable: true,
			value: (input: ColorInput): ChainableStyleFn => {
				const resolved = capabilitiesForCall();
				return createChainableStyle(
					[
						...steps,
						{
							kind: "pair",
							pair: fgPairAtDepth(input, resolved.colorDepth),
							isModifier: false,
						},
					],
					false,
					resolved,
				);
			},
			writable: false,
		});
		Object.defineProperty(styleFn, "bg", {
			configurable: false,
			enumerable: true,
			value: (input: ColorInput): ChainableStyleFn => {
				const resolved = capabilitiesForCall();
				return createChainableStyle(
					[
						...steps,
						{
							kind: "pair",
							pair: bgPairAtDepth(input, resolved.colorDepth),
							isModifier: false,
						},
					],
					false,
					resolved,
				);
			},
			writable: false,
		});

		// Attach `open` / `close` so the chainable doubles as an `AnsiPair`.
		// Composition rule: open in declaration order, close in reverse —
		// matches what `applyChain` actually emits (innermost wraps first,
		// then walks outward).
		let open = "";
		let close = "";
		for (const step of steps) {
			const pair = stepPair(step);
			open += pair.open;
			close = pair.close + close;
		}
		Object.defineProperty(styleFn, "open", {
			value: open,
			writable: false,
			configurable: false,
			enumerable: true,
		});
		Object.defineProperty(styleFn, "close", {
			value: close,
			writable: false,
			configurable: false,
			enumerable: true,
		});

		return Object.freeze(styleFn);
	}

	return createChainableStyle;
}

function buildStyleMethods(
	createChainableStyle: (steps: readonly ChainStep[]) => ChainableStyleFn,
): StyleMethodMap {
	const methods = {} as { [K in StyleMethodName]: ChainableStyleFn };

	for (const methodName of styleMethodNames) {
		methods[methodName] = createChainableStyle([{ kind: "named", name: methodName }]);
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
 * `NO_COLOR`, non-color modifiers (bold, italic, etc.) follow TTY only,
 * and `FORCE_COLOR`, when set, decides unconditionally for both.
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
function resolveStyleCapabilities(options?: StyleOptions): ResolvedStyleCapabilities {
	const mode = options?.mode ?? "auto";
	const modifiersEnabled = resolveModifierCapability(mode, options?.overrides);
	const colorDepth = resolveColorDepth(mode, options?.overrides);
	return {
		modifiersEnabled,
		colorDepth,
		colorsEnabled: colorDepth !== "none",
		trueColorEnabled: colorDepth === "truecolor",
		hyperlinksEnabled: resolveHyperlinkCapability(mode, options?.overrides),
	};
}

// The cache key includes every environment input used by capability resolution.
const runtimeCapabilitiesCache = new Map<string, ResolvedStyleCapabilities>();

function resolveRuntimeCapabilities(): ResolvedStyleCapabilities {
	const key = [
		process.stdout?.isTTY ?? false,
		process.env.NO_COLOR ?? "",
		process.env.FORCE_COLOR ?? "\u0000",
		process.env.COLORTERM ?? "",
		process.env.TERM ?? "",
	].join("|");
	const cached = runtimeCapabilitiesCache.get(key);
	if (cached) return cached;
	const resolved = resolveStyleCapabilities();
	runtimeCapabilitiesCache.set(key, resolved);
	return resolved;
}

function createStyleInstance(options: StyleOptions | undefined, runtime: boolean): StyleInstance {
	const fixedCapabilities = runtime ? undefined : resolveStyleCapabilities(options);
	const resolveCapabilities = runtime
		? resolveRuntimeCapabilities
		: () => fixedCapabilities as ResolvedStyleCapabilities;
	const createChainableStyle = buildChainableStyleFactory(resolveCapabilities, runtime);
	const methods = buildStyleMethods(createChainableStyle);

	const instance: StyleInstance = {
		get enabled() {
			const { modifiersEnabled, colorsEnabled } = resolveCapabilities();
			return modifiersEnabled || colorsEnabled;
		},
		get colorsEnabled() {
			return resolveCapabilities().colorsEnabled;
		},
		get trueColorEnabled() {
			return resolveCapabilities().trueColorEnabled;
		},
		get colorDepth() {
			return resolveCapabilities().colorDepth;
		},

		link(text, url, hyperlinkOptions) {
			if (resolveCapabilities().hyperlinksEnabled) {
				return linkDirect(text, url, hyperlinkOptions);
			}
			// Validate even when emission is disabled so malformed URLs and IDs
			// cannot pass silently through non-TTY paths.
			linkCode(url, hyperlinkOptions);
			return text;
		},

		// Two call shapes (see StyleInstance.fg JSDoc):
		//   fg(input)        → ChainableStyleFn (chain root)
		//   fg(text, input)  → string (direct)
		fg: ((textOrInput: ColorInput, maybeInput?: ColorInput): string | ChainableStyleFn => {
			const resolved = resolveCapabilities();
			if (maybeInput === undefined) {
				return createChainableStyle(
					[
						{
							kind: "pair",
							pair: fgPairAtDepth(textOrInput, resolved.colorDepth),
							isModifier: false,
						},
					],
					false,
					resolved,
				);
			}
			return fgDirect(textOrInput as string, maybeInput, resolved.colorDepth);
		}) as StyleInstance["fg"],

		bg: ((textOrInput: ColorInput, maybeInput?: ColorInput): string | ChainableStyleFn => {
			const resolved = resolveCapabilities();
			if (maybeInput === undefined) {
				return createChainableStyle(
					[
						{
							kind: "pair",
							pair: bgPairAtDepth(textOrInput, resolved.colorDepth),
							isModifier: false,
						},
					],
					false,
					resolved,
				);
			}
			return bgDirect(textOrInput as string, maybeInput, resolved.colorDepth);
		}) as StyleInstance["bg"],

		...methods,
	};

	return Object.freeze(instance);
}

export function createStyle(options?: StyleOptions): StyleInstance {
	return createStyleInstance(options, false);
}

/**
 * Default style instance using `"auto"` mode.
 *
 * Emits color ANSI codes when stdout is a TTY and `NO_COLOR` is not set.
 * Non-color modifiers (bold, italic, etc.) follow TTY only; `FORCE_COLOR`,
 * when set, decides unconditionally for both.
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
export const style: StyleInstance = createStyleInstance(undefined, true);
