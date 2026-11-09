import { describe, expect, it } from "vite-plus/test";

import { styleMethodNames } from "./ansi-codes.ts";
import { createStyle } from "./create-style.ts";
import { createPlainStyle } from "./plain-style.ts";
import type { StyleOptions } from "./types.ts";

const options: readonly (readonly [label: string, options: StyleOptions])[] = [
	["always", { mode: "always" }],
	["never", { mode: "never" }],
	["auto, TTY", { overrides: { isTTY: true, term: "xterm-256color" } }],
	["auto, non-TTY", { overrides: { isTTY: false } }],
	["auto, TTY with NO_COLOR", { overrides: { isTTY: true, noColor: "1" } }],
	["auto, TTY with TERM=dumb", { overrides: { isTTY: true, term: "dumb" } }],
	["auto, non-TTY with FORCE_COLOR=1", { overrides: { isTTY: false, forceColor: "1" } }],
	["auto, TTY with FORCE_COLOR=0", { overrides: { isTTY: true, forceColor: "0" } }],
];

describe("createPlainStyle", () => {
	it.each(options)("matches createStyle with the same options (%s)", (_label, opts) => {
		const plain = createPlainStyle(opts);
		const chain = createStyle(opts);
		for (const name of styleMethodNames) {
			for (const input of ["text", "", undefined, null, 42, `a ${chain.bold("b")} c`]) {
				expect(plain[name](input), `${name}(${String(input)})`).toBe(chain[name](input));
			}
			expect(plain[name]`x ${chain[name]("y")} ${1}`, `${name} template`).toBe(
				chain[name]`x ${chain[name]("y")} ${1}`,
			);
		}
	});
});
