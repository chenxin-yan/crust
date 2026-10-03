import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { styleMethodNames } from "./ansi-codes.ts";
import * as runtimeExports from "./runtime-exports.ts";
import {
	bgRed,
	black,
	blue,
	bold,
	cyan,
	dim,
	fg,
	gray,
	green,
	hidden,
	inverse,
	italic,
	magenta,
	red,
	strikethrough,
	underline,
	white,
	yellow,
} from "./runtime-exports.ts";

afterEach(() => vi.unstubAllEnvs());

describe("runtime exports", () => {
	it("exports every registered style method", () => {
		expect(styleMethodNames.filter((name) => !(name in runtimeExports))).toEqual([]);
	});
});

describe("top-level static styles", () => {
	it.each([
		{ name: "bold", fn: bold, open: 1, close: 22 },
		{ name: "dim", fn: dim, open: 2, close: 22 },
		{ name: "italic", fn: italic, open: 3, close: 23 },
		{ name: "underline", fn: underline, open: 4, close: 24 },
		{ name: "inverse", fn: inverse, open: 7, close: 27 },
		{ name: "hidden", fn: hidden, open: 8, close: 28 },
		{ name: "strikethrough", fn: strikethrough, open: 9, close: 29 },
		{ name: "black", fn: black, open: 30, close: 39 },
		{ name: "red", fn: red, open: 31, close: 39 },
		{ name: "green", fn: green, open: 32, close: 39 },
		{ name: "yellow", fn: yellow, open: 33, close: 39 },
		{ name: "blue", fn: blue, open: 34, close: 39 },
		{ name: "magenta", fn: magenta, open: 35, close: 39 },
		{ name: "cyan", fn: cyan, open: 36, close: 39 },
		{ name: "white", fn: white, open: 37, close: 39 },
		{ name: "gray", fn: gray, open: 90, close: 39 },
		{ name: "bgRed", fn: bgRed, open: 41, close: 49 },
	])("$name applies SGR $open/$close", ({ fn, open, close }) => {
		vi.stubEnv("FORCE_COLOR", "3");
		expect(fn("t")).toBe(`\x1b[${open}mt\x1b[${close}m`);
	});
});

// ───────────────────────────────────────────────────────────────────────────
// Top-level chainables — full surface
// ───────────────────────────────────────────────────────────────────────────
//
// Top-level imports expose the same surface as `style.bold` etc. (tagged
// templates, chain methods, fg/bg, AnsiPair shape).

describe("top-level chainables — full surface", () => {
	it("top-level tagged-template interleaves interpolations", () => {
		vi.stubEnv("FORCE_COLOR", "3");
		expect(bold`hello ${42}!`).toBe("\x1b[1mhello 42!\x1b[22m");
	});

	it("top-level dynamic colors support direct and chain-root calls", () => {
		vi.stubEnv("FORCE_COLOR", "3");
		expect(fg("x", "#ff0000")).toBe("\x1b[38;2;255;0;0mx\x1b[39m");
		expect(fg("#ff0000")("x")).toBe("\x1b[38;2;255;0;0mx\x1b[39m");
		expect(bold.fg("#ff0000")("x")).toBe("\x1b[1m\x1b[38;2;255;0;0mx\x1b[39m\x1b[22m");
	});

	it("top-level chain `bold.red.bgYellow('hi')` composes", () => {
		vi.stubEnv("FORCE_COLOR", "3");
		expect(bold.red.bgYellow("hi")).toBe("\x1b[1m\x1b[31m\x1b[43mhi\x1b[49m\x1b[39m\x1b[22m");
	});
});
