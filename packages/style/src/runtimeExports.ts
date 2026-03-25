import { getRuntimeStyle } from "./createStyle.ts";
import type { StyleFn, StyleMethodName } from "./types.ts";

function createStyleMethodWrapper(name: StyleMethodName): StyleFn {
	return (text: string) => getRuntimeStyle()[name](text);
}

export const black: StyleFn = createStyleMethodWrapper("black");
export const red: StyleFn = createStyleMethodWrapper("red");
export const green: StyleFn = createStyleMethodWrapper("green");
export const yellow: StyleFn = createStyleMethodWrapper("yellow");
export const blue: StyleFn = createStyleMethodWrapper("blue");
export const magenta: StyleFn = createStyleMethodWrapper("magenta");
export const cyan: StyleFn = createStyleMethodWrapper("cyan");
export const white: StyleFn = createStyleMethodWrapper("white");
export const gray: StyleFn = createStyleMethodWrapper("gray");
export const brightRed: StyleFn = createStyleMethodWrapper("brightRed");
export const brightGreen: StyleFn = createStyleMethodWrapper("brightGreen");
export const brightYellow: StyleFn = createStyleMethodWrapper("brightYellow");
export const brightBlue: StyleFn = createStyleMethodWrapper("brightBlue");
export const brightMagenta: StyleFn = createStyleMethodWrapper("brightMagenta");
export const brightCyan: StyleFn = createStyleMethodWrapper("brightCyan");
export const brightWhite: StyleFn = createStyleMethodWrapper("brightWhite");
export const bgBlack: StyleFn = createStyleMethodWrapper("bgBlack");
export const bgRed: StyleFn = createStyleMethodWrapper("bgRed");
export const bgGreen: StyleFn = createStyleMethodWrapper("bgGreen");
export const bgYellow: StyleFn = createStyleMethodWrapper("bgYellow");
export const bgBlue: StyleFn = createStyleMethodWrapper("bgBlue");
export const bgMagenta: StyleFn = createStyleMethodWrapper("bgMagenta");
export const bgCyan: StyleFn = createStyleMethodWrapper("bgCyan");
export const bgWhite: StyleFn = createStyleMethodWrapper("bgWhite");
export const bgBrightBlack: StyleFn = createStyleMethodWrapper("bgBrightBlack");
export const bgBrightRed: StyleFn = createStyleMethodWrapper("bgBrightRed");
export const bgBrightGreen: StyleFn = createStyleMethodWrapper("bgBrightGreen");
export const bgBrightYellow: StyleFn =
	createStyleMethodWrapper("bgBrightYellow");
export const bgBrightBlue: StyleFn = createStyleMethodWrapper("bgBrightBlue");
export const bgBrightMagenta: StyleFn =
	createStyleMethodWrapper("bgBrightMagenta");
export const bgBrightCyan: StyleFn = createStyleMethodWrapper("bgBrightCyan");
export const bgBrightWhite: StyleFn = createStyleMethodWrapper("bgBrightWhite");
export const bold: StyleFn = createStyleMethodWrapper("bold");
export const dim: StyleFn = createStyleMethodWrapper("dim");
export const italic: StyleFn = createStyleMethodWrapper("italic");
export const underline: StyleFn = createStyleMethodWrapper("underline");
export const inverse: StyleFn = createStyleMethodWrapper("inverse");
export const hidden: StyleFn = createStyleMethodWrapper("hidden");
export const strikethrough: StyleFn = createStyleMethodWrapper("strikethrough");

export function rgb(text: string, r: number, g: number, b: number): string {
	return getRuntimeStyle().rgb(text, r, g, b);
}

export function bgRgb(text: string, r: number, g: number, b: number): string {
	return getRuntimeStyle().bgRgb(text, r, g, b);
}

export function hex(text: string, hexColor: string): string {
	return getRuntimeStyle().hex(text, hexColor);
}

export function bgHex(text: string, hexColor: string): string {
	return getRuntimeStyle().bgHex(text, hexColor);
}
