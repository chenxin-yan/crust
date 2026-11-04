// ────────────────────────────────────────────────────────────────────────────
// Runtime Exports — Top-level color/modifier helpers
// ────────────────────────────────────────────────────────────────────────────

import { style } from "./create-style.ts";
import type { ChainableStyleFn, StyleInstance } from "./types.ts";

// A pure call (unlike a property read) lets bundlers drop every helper a consumer
// never imports, and the default instance with them when none is used.
function member<K extends keyof StyleInstance>(key: K): StyleInstance[K] {
	return style[key];
}

export const black: ChainableStyleFn = /* @__PURE__ */ member("black");
export const red: ChainableStyleFn = /* @__PURE__ */ member("red");
export const green: ChainableStyleFn = /* @__PURE__ */ member("green");
export const yellow: ChainableStyleFn = /* @__PURE__ */ member("yellow");
export const blue: ChainableStyleFn = /* @__PURE__ */ member("blue");
export const magenta: ChainableStyleFn = /* @__PURE__ */ member("magenta");
export const cyan: ChainableStyleFn = /* @__PURE__ */ member("cyan");
export const white: ChainableStyleFn = /* @__PURE__ */ member("white");
export const gray: ChainableStyleFn = /* @__PURE__ */ member("gray");
export const brightRed: ChainableStyleFn = /* @__PURE__ */ member("brightRed");
export const brightGreen: ChainableStyleFn = /* @__PURE__ */ member("brightGreen");
export const brightYellow: ChainableStyleFn = /* @__PURE__ */ member("brightYellow");
export const brightBlue: ChainableStyleFn = /* @__PURE__ */ member("brightBlue");
export const brightMagenta: ChainableStyleFn = /* @__PURE__ */ member("brightMagenta");
export const brightCyan: ChainableStyleFn = /* @__PURE__ */ member("brightCyan");
export const brightWhite: ChainableStyleFn = /* @__PURE__ */ member("brightWhite");
export const bgBlack: ChainableStyleFn = /* @__PURE__ */ member("bgBlack");
export const bgRed: ChainableStyleFn = /* @__PURE__ */ member("bgRed");
export const bgGreen: ChainableStyleFn = /* @__PURE__ */ member("bgGreen");
export const bgYellow: ChainableStyleFn = /* @__PURE__ */ member("bgYellow");
export const bgBlue: ChainableStyleFn = /* @__PURE__ */ member("bgBlue");
export const bgMagenta: ChainableStyleFn = /* @__PURE__ */ member("bgMagenta");
export const bgCyan: ChainableStyleFn = /* @__PURE__ */ member("bgCyan");
export const bgWhite: ChainableStyleFn = /* @__PURE__ */ member("bgWhite");
export const bgBrightBlack: ChainableStyleFn = /* @__PURE__ */ member("bgBrightBlack");
export const bgBrightRed: ChainableStyleFn = /* @__PURE__ */ member("bgBrightRed");
export const bgBrightGreen: ChainableStyleFn = /* @__PURE__ */ member("bgBrightGreen");
export const bgBrightYellow: ChainableStyleFn = /* @__PURE__ */ member("bgBrightYellow");
export const bgBrightBlue: ChainableStyleFn = /* @__PURE__ */ member("bgBrightBlue");
export const bgBrightMagenta: ChainableStyleFn = /* @__PURE__ */ member("bgBrightMagenta");
export const bgBrightCyan: ChainableStyleFn = /* @__PURE__ */ member("bgBrightCyan");
export const bgBrightWhite: ChainableStyleFn = /* @__PURE__ */ member("bgBrightWhite");
export const bold: ChainableStyleFn = /* @__PURE__ */ member("bold");
export const dim: ChainableStyleFn = /* @__PURE__ */ member("dim");
export const italic: ChainableStyleFn = /* @__PURE__ */ member("italic");
export const underline: ChainableStyleFn = /* @__PURE__ */ member("underline");
export const inverse: ChainableStyleFn = /* @__PURE__ */ member("inverse");
export const hidden: ChainableStyleFn = /* @__PURE__ */ member("hidden");
export const strikethrough: ChainableStyleFn = /* @__PURE__ */ member("strikethrough");
export const link: StyleInstance["link"] = /* @__PURE__ */ member("link");
export const fg: StyleInstance["fg"] = /* @__PURE__ */ member("fg");
export const bg: StyleInstance["bg"] = /* @__PURE__ */ member("bg");
