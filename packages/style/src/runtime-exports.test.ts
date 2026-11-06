import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { type StyleMethodName, styleMethodNames } from "./ansi-codes.ts";
import { style } from "./create-style.ts";
import * as runtimeExports from "./runtime-exports.ts";
import type { PlainStyleFn } from "./types.ts";

const bareExports: Record<StyleMethodName, PlainStyleFn> = runtimeExports;

const originalStdoutIsTTY = process.stdout.isTTY;

afterEach(() => {
	vi.unstubAllEnvs();
	Object.defineProperty(process.stdout, "isTTY", {
		configurable: true,
		value: originalStdoutIsTTY,
	});
});

const environments = [
	{ name: "TTY", isTTY: true, env: {} },
	{ name: "TTY with NO_COLOR", isTTY: true, env: { NO_COLOR: "1" } },
	{ name: "TTY with TERM=dumb", isTTY: true, env: { TERM: "dumb" } },
	{ name: "non-TTY", isTTY: false, env: {} },
	{ name: "non-TTY with FORCE_COLOR=1", isTTY: false, env: { FORCE_COLOR: "1" } },
	{ name: "TTY with FORCE_COLOR=0", isTTY: true, env: { FORCE_COLOR: "0" } },
] as const;

describe("runtime exports", () => {
	it("exports every registered style method", () => {
		expect(styleMethodNames.filter((name) => !(name in runtimeExports))).toEqual([]);
	});

	it("exports plain functions that do not chain", () => {
		for (const name of styleMethodNames) {
			const fn: object = bareExports[name];
			expect(Object.getPrototypeOf(fn) === Function.prototype, name).toBe(true);
			const chainKeys = [...styleMethodNames, "open", "close", "fg", "bg"].filter(
				(key) => key in fn,
			);
			expect(chainKeys, name).toEqual([]);
		}
	});

	it.each(environments)("matches the default style instance ($name)", ({ isTTY, env }) => {
		for (const key of ["NO_COLOR", "FORCE_COLOR", "COLORTERM", "TERM"] as const) {
			vi.stubEnv(key, env[key as keyof typeof env]);
		}
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: isTTY });

		for (const name of styleMethodNames) {
			const bare = bareExports[name];
			const chain = style[name];
			for (const input of ["text", "", undefined, null, 42, `a ${style.bold("b")} c`]) {
				expect(bare(input), `${name}(${String(input)})`).toBe(chain(input));
			}
			expect(bare`x ${style[name]("y")} ${1}`, `${name} template`).toBe(
				chain`x ${style[name]("y")} ${1}`,
			);
		}
	});
});
