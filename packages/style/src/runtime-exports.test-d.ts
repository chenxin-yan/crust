import { bold, red, style, type StyleFn } from "./index.ts";

function _bareExportsDoNotChain() {
	// @ts-expect-error Bare exports are plain functions; chain on `style` instead.
	bold.red("text");
	// @ts-expect-error Bare exports carry no ANSI pair.
	void bold.open;
	style.bold.red("text");
}

function _bareExportsStayCallable(count: number) {
	const _text: string = bold("text");
	const _template: string = red`Count: ${count}`;
	const _nullish: string = bold(undefined);
	const _fn: StyleFn = bold;
}
