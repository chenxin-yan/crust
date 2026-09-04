// ────────────────────────────────────────────────────────────────────────────
// Runtime Exports — Top-level color/modifier helpers
// ────────────────────────────────────────────────────────────────────────────

import { style } from "./createStyle.ts";
import type { ChainableStyleFn, StyleInstance } from "./types.ts";

export const black: ChainableStyleFn = style.black;
export const red: ChainableStyleFn = style.red;
export const green: ChainableStyleFn = style.green;
export const yellow: ChainableStyleFn = style.yellow;
export const blue: ChainableStyleFn = style.blue;
export const magenta: ChainableStyleFn = style.magenta;
export const cyan: ChainableStyleFn = style.cyan;
export const white: ChainableStyleFn = style.white;
export const gray: ChainableStyleFn = style.gray;
export const brightRed: ChainableStyleFn = style.brightRed;
export const brightGreen: ChainableStyleFn = style.brightGreen;
export const brightYellow: ChainableStyleFn = style.brightYellow;
export const brightBlue: ChainableStyleFn = style.brightBlue;
export const brightMagenta: ChainableStyleFn = style.brightMagenta;
export const brightCyan: ChainableStyleFn = style.brightCyan;
export const brightWhite: ChainableStyleFn = style.brightWhite;
export const bgBlack: ChainableStyleFn = style.bgBlack;
export const bgRed: ChainableStyleFn = style.bgRed;
export const bgGreen: ChainableStyleFn = style.bgGreen;
export const bgYellow: ChainableStyleFn = style.bgYellow;
export const bgBlue: ChainableStyleFn = style.bgBlue;
export const bgMagenta: ChainableStyleFn = style.bgMagenta;
export const bgCyan: ChainableStyleFn = style.bgCyan;
export const bgWhite: ChainableStyleFn = style.bgWhite;
export const bgBrightBlack: ChainableStyleFn = style.bgBrightBlack;
export const bgBrightRed: ChainableStyleFn = style.bgBrightRed;
export const bgBrightGreen: ChainableStyleFn = style.bgBrightGreen;
export const bgBrightYellow: ChainableStyleFn = style.bgBrightYellow;
export const bgBrightBlue: ChainableStyleFn = style.bgBrightBlue;
export const bgBrightMagenta: ChainableStyleFn = style.bgBrightMagenta;
export const bgBrightCyan: ChainableStyleFn = style.bgBrightCyan;
export const bgBrightWhite: ChainableStyleFn = style.bgBrightWhite;
export const bold: ChainableStyleFn = style.bold;
export const dim: ChainableStyleFn = style.dim;
export const italic: ChainableStyleFn = style.italic;
export const underline: ChainableStyleFn = style.underline;
export const inverse: ChainableStyleFn = style.inverse;
export const hidden: ChainableStyleFn = style.hidden;
export const strikethrough: ChainableStyleFn = style.strikethrough;
export const link: StyleInstance["link"] = style.link;
export const fg: StyleInstance["fg"] = style.fg;
export const bg: StyleInstance["bg"] = style.bg;
