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
	ColorMode,
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

function applyChain(
	text: string,
	steps: readonly ChainStep[],
	modifiersEnabled: boolean,
	colorsEnabled: boolean,
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
	modifiersEnabled: boolean,
	colorsEnabled: boolean,
	colorDepth: ColorDepth,
) {
	const cache = new Map<string, ChainableStyleFn>();

	function makeKey(steps: readonly ChainStep[]): string {
		// Cache key: registered names use the name; dynamic pairs use the
		// open code (small enough, unique per pair).
		return steps.map((s) => (s.kind === "named" ? s.name : `~${s.pair.open}`)).join("|");
	}

	function createChainableStyle(steps: readonly ChainStep[]): ChainableStyleFn {
		const key = makeKey(steps);
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
				return applyChain(text, steps, modifiersEnabled, colorsEnabled);
			}
			return applyChain(first as string, steps, modifiersEnabled, colorsEnabled);
		}) as ChainableStyleFn;

		cache.set(key, styleFn);

		// Registered chain methods (bold, red, bgYellow, ...)
		for (const name of styleMethodNames) {
			Object.defineProperty(styleFn, name, {
				configurable: false,
				enumerable: true,
				get() {
					return createChainableStyle([...steps, { kind: "named", name }]);
				},
			});
		}

		// Dynamic-color chain methods (depth-aware via instance's `colorDepth`)
		Object.defineProperty(styleFn, "fg", {
			configurable: false,
			enumerable: true,
			value: (input: ColorInput): ChainableStyleFn =>
				createChainableStyle([
					...steps,
					{
						kind: "pair",
						pair: fgPairAtDepth(input, colorDepth),
						isModifier: false,
					},
				]),
			writable: false,
		});
		Object.defineProperty(styleFn, "bg", {
			configurable: false,
			enumerable: true,
			value: (input: ColorInput): ChainableStyleFn =>
				createChainableStyle([
					...steps,
					{
						kind: "pair",
						pair: bgPairAtDepth(input, colorDepth),
						isModifier: false,
					},
				]),
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
export function createStyle(options?: StyleOptions): StyleInstance {
	const mode = options?.mode ?? "auto";
	const modifiersEnabled = resolveModifierCapability(mode, options?.overrides);
	const colorDepth: ColorDepth = resolveColorDepth(mode, options?.overrides);
	const colorsEnabled = colorDepth !== "none";
	const trueColorEnabled = colorDepth === "truecolor";
	const hyperlinksEnabled = resolveHyperlinkCapability(mode, options?.overrides);
	const enabled = modifiersEnabled || colorsEnabled;
	const createChainableStyle = buildChainableStyleFactory(
		modifiersEnabled,
		colorsEnabled,
		colorDepth,
	);
	const methods = buildStyleMethods(createChainableStyle);

	const instance: StyleInstance = {
		enabled,
		colorsEnabled,
		trueColorEnabled,
		colorDepth,

		link: hyperlinksEnabled
			? (text: string, url: string, hyperlinkOptions) => linkDirect(text, url, hyperlinkOptions)
			: (text: string, url: string, hyperlinkOptions) => {
					// Validate even when emission is disabled so callers can't
					// silently smuggle malformed URLs/IDs through non-TTY paths.
					// linkCode throws on bad input; we discard the returned pair.
					linkCode(url, hyperlinkOptions);
					return text;
				},

		// ── Dynamic colors (depth-aware) ──────────────────────────────

		// Two call shapes (see StyleInstance.fg JSDoc):
		//   fg(input)        → ChainableStyleFn (chain root)
		//   fg(text, input)  → string (direct)
		fg: ((textOrInput: ColorInput, maybeInput?: ColorInput): string | ChainableStyleFn => {
			if (maybeInput === undefined) {
				return createChainableStyle([
					{
						kind: "pair",
						pair: fgPairAtDepth(textOrInput, colorDepth),
						isModifier: false,
					},
				]);
			}
			return fgDirect(textOrInput as string, maybeInput, colorDepth);
		}) as StyleInstance["fg"],

		bg: ((textOrInput: ColorInput, maybeInput?: ColorInput): string | ChainableStyleFn => {
			if (maybeInput === undefined) {
				return createChainableStyle([
					{
						kind: "pair",
						pair: bgPairAtDepth(textOrInput, colorDepth),
						isModifier: false,
					},
				]);
			}
			return bgDirect(textOrInput as string, maybeInput, colorDepth);
		}) as StyleInstance["bg"],

		...methods,
	};

	return Object.freeze(instance);
}

// The runtime `style` facade and top-level helpers are forwarders into a
// cached `"auto"`-mode instance. The environment is the single source of
// truth — the cache key must include every input capability resolution
// depends on: `stdout.isTTY`, `NO_COLOR`, `FORCE_COLOR`, `COLORTERM`,
// `TERM`. Env changes (e.g. a `--color` flag handler setting
// `FORCE_COLOR`) take effect on the next call.
const runtimeStyleCache = new Map<string, StyleInstance>();

function getRuntimeStyle(): StyleInstance {
	const key = [
		process.stdout?.isTTY ?? false,
		process.env.NO_COLOR ?? "",
		process.env.FORCE_COLOR ?? "\u0000",
		process.env.COLORTERM ?? "",
		process.env.TERM ?? "",
	].join("|");
	const cached = runtimeStyleCache.get(key);
	if (cached) {
		return cached;
	}
	const built = createStyle({ mode: "auto" });
	runtimeStyleCache.set(key, built);
	return built;
}

// Members whose implementation is a function and must be forwarded as a
// bound method so callers can invoke them like `style.link(...)`.
const FORWARDED_METHODS = ["link", "fg", "bg"] as const;

// Members that read a value off the current runtime style on every access.
const FORWARDED_GETTERS = ["enabled", "colorsEnabled", "trueColorEnabled", "colorDepth"] as const;

/**
 * Build a `ChainableStyleFn` whose calls and chain accesses forward to
 * `getRuntimeStyle()[name]` on every invocation. This is the bridge that
 * lets environment changes (`NO_COLOR`, `FORCE_COLOR`, TTY) take effect
 * on captured references:
 *
 * ```ts
 * const myBold = style.bold;    // captured forwarder, not a snapshot
 * process.env.FORCE_COLOR = "0";
 * myBold("x"); // "x" — resolves the current runtime instance
 * ```
 *
 * The forwarder is also the implementation of the top-level re-exports in
 * `runtimeExports.ts` (`bold`, `red`, etc.) so they share the same
 * lifecycle semantics.
 *
 * `open` / `close` are static — the ANSI codes for `name` never change at
 * runtime; only emission gating depends on the active mode.
 *
 * @internal
 */
export function createForwardingChainable(name: StyleMethodName): ChainableStyleFn {
	// Forward (...args) so tagged-template calls work (the runtime
	// instance's chainable dispatcher detects TemplateStringsArray on its
	// own).
	const fn = ((...args: unknown[]) =>
		(getRuntimeStyle()[name] as any)(...args)) as ChainableStyleFn;

	// Child chain methods (bold, red, bgYellow, ...) — each property
	// access re-resolves the runtime instance so further chaining honors
	// the current global mode.
	for (const childName of styleMethodNames) {
		Object.defineProperty(fn, childName, {
			configurable: false,
			enumerable: true,
			get() {
				return (getRuntimeStyle()[name] as any)[childName];
			},
		});
	}

	// Dynamic-color chain methods. Resolved at call time — the returned
	// chainable is locked to the runtime instance active when `.fg(input)` /
	// `.bg(input)` is called (matching how every chalk/ansis chain composes).
	Object.defineProperty(fn, "fg", {
		configurable: false,
		enumerable: true,
		value: (input: ColorInput): ChainableStyleFn =>
			(getRuntimeStyle()[name] as any).fg(input) as ChainableStyleFn,
		writable: false,
	});
	Object.defineProperty(fn, "bg", {
		configurable: false,
		enumerable: true,
		value: (input: ColorInput): ChainableStyleFn =>
			(getRuntimeStyle()[name] as any).bg(input) as ChainableStyleFn,
		writable: false,
	});

	// Static `open` / `close`. These are the ANSI codes for the leaf
	// `name` only — chained accesses (e.g. `bold.red`) compose their own
	// open/close on the inner chainable returned from the runtime
	// instance. See `createChainableStyle` in this file.
	const pair = stylePairFor(name);
	Object.defineProperty(fn, "open", {
		value: pair.open,
		writable: false,
		configurable: false,
		enumerable: true,
	});
	Object.defineProperty(fn, "close", {
		value: pair.close,
		writable: false,
		configurable: false,
		enumerable: true,
	});

	return Object.freeze(fn);
}

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
				return (getRuntimeStyle()[key] as any)(...args);
			},
			writable: false,
		});
	}

	// Use forwarding chainables so captured references (`const x = style.bold`)
	// honor later environment changes. Each chain method is built
	// once at facade construction time and shared across all accesses.
	for (const name of styleMethodNames) {
		Object.defineProperty(facade, name, {
			configurable: false,
			enumerable: true,
			value: createForwardingChainable(name),
			writable: false,
		});
	}

	return Object.freeze(facade);
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
export const style: StyleInstance = createRuntimeStyleFacade();
