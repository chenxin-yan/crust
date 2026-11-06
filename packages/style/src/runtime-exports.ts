// ────────────────────────────────────────────────────────────────────────────
// Runtime Exports — Top-level color/modifier helpers
// ────────────────────────────────────────────────────────────────────────────

import { resolveColorDepth, resolveModifierCapability } from "./capability.ts";
import { style } from "./create-style.ts";
import { applyStyle, callText } from "./style-engine.ts";
import type { PlainStyleFn, StyleInput, StyleInstance } from "./types.ts";

// Bare helpers are plain functions so importing one does not pull in the chain
// engine (shared prototype getters, colour parsing, CSS colour names). SGR codes
// are inlined rather than read from the ansi-codes tables, which bundlers cannot
// split per property; runtime-exports.test.ts checks each against `style`.
function plain(open: number, close: number, isModifier: boolean): PlainStyleFn {
	const pair = { open: `\x1b[${open}m`, close: `\x1b[${close}m` };
	return (first: StyleInput | TemplateStringsArray, ...values: unknown[]) => {
		const text = callText(first, values);
		// Resolved per call, like the default `style` instance.
		const enabled = isModifier
			? resolveModifierCapability("auto")
			: resolveColorDepth("auto") !== "none";
		return enabled ? applyStyle(text, pair) : text == null ? "" : String(text);
	};
}

function modifier(open: number, close: number): PlainStyleFn {
	return plain(open, close, true);
}

function color(open: number, close: number): PlainStyleFn {
	return plain(open, close, false);
}

// A pure call (unlike a property read) lets bundlers drop every helper a consumer
// never imports, and the default instance with them when none is used.
function member<K extends keyof StyleInstance>(key: K): StyleInstance[K] {
	return style[key];
}

export const black: PlainStyleFn = /* @__PURE__ */ color(30, 39);
export const red: PlainStyleFn = /* @__PURE__ */ color(31, 39);
export const green: PlainStyleFn = /* @__PURE__ */ color(32, 39);
export const yellow: PlainStyleFn = /* @__PURE__ */ color(33, 39);
export const blue: PlainStyleFn = /* @__PURE__ */ color(34, 39);
export const magenta: PlainStyleFn = /* @__PURE__ */ color(35, 39);
export const cyan: PlainStyleFn = /* @__PURE__ */ color(36, 39);
export const white: PlainStyleFn = /* @__PURE__ */ color(37, 39);
export const gray: PlainStyleFn = /* @__PURE__ */ color(90, 39);
export const brightRed: PlainStyleFn = /* @__PURE__ */ color(91, 39);
export const brightGreen: PlainStyleFn = /* @__PURE__ */ color(92, 39);
export const brightYellow: PlainStyleFn = /* @__PURE__ */ color(93, 39);
export const brightBlue: PlainStyleFn = /* @__PURE__ */ color(94, 39);
export const brightMagenta: PlainStyleFn = /* @__PURE__ */ color(95, 39);
export const brightCyan: PlainStyleFn = /* @__PURE__ */ color(96, 39);
export const brightWhite: PlainStyleFn = /* @__PURE__ */ color(97, 39);
export const bgBlack: PlainStyleFn = /* @__PURE__ */ color(40, 49);
export const bgRed: PlainStyleFn = /* @__PURE__ */ color(41, 49);
export const bgGreen: PlainStyleFn = /* @__PURE__ */ color(42, 49);
export const bgYellow: PlainStyleFn = /* @__PURE__ */ color(43, 49);
export const bgBlue: PlainStyleFn = /* @__PURE__ */ color(44, 49);
export const bgMagenta: PlainStyleFn = /* @__PURE__ */ color(45, 49);
export const bgCyan: PlainStyleFn = /* @__PURE__ */ color(46, 49);
export const bgWhite: PlainStyleFn = /* @__PURE__ */ color(47, 49);
export const bgBrightBlack: PlainStyleFn = /* @__PURE__ */ color(100, 49);
export const bgBrightRed: PlainStyleFn = /* @__PURE__ */ color(101, 49);
export const bgBrightGreen: PlainStyleFn = /* @__PURE__ */ color(102, 49);
export const bgBrightYellow: PlainStyleFn = /* @__PURE__ */ color(103, 49);
export const bgBrightBlue: PlainStyleFn = /* @__PURE__ */ color(104, 49);
export const bgBrightMagenta: PlainStyleFn = /* @__PURE__ */ color(105, 49);
export const bgBrightCyan: PlainStyleFn = /* @__PURE__ */ color(106, 49);
export const bgBrightWhite: PlainStyleFn = /* @__PURE__ */ color(107, 49);
export const bold: PlainStyleFn = /* @__PURE__ */ modifier(1, 22);
export const dim: PlainStyleFn = /* @__PURE__ */ modifier(2, 22);
export const italic: PlainStyleFn = /* @__PURE__ */ modifier(3, 23);
export const underline: PlainStyleFn = /* @__PURE__ */ modifier(4, 24);
export const inverse: PlainStyleFn = /* @__PURE__ */ modifier(7, 27);
export const hidden: PlainStyleFn = /* @__PURE__ */ modifier(8, 28);
export const strikethrough: PlainStyleFn = /* @__PURE__ */ modifier(9, 29);
export const link: StyleInstance["link"] = /* @__PURE__ */ member("link");
export const fg: StyleInstance["fg"] = /* @__PURE__ */ member("fg");
export const bg: StyleInstance["bg"] = /* @__PURE__ */ member("bg");
