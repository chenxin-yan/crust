import { describe, expect, it } from "bun:test";

import { bold, cyan, green, magenta, red, yellow } from "@crustjs/style";

import { createProgress } from "./create-progress.ts";
import { defaultTheme, resolveTheme } from "./theme.ts";

describe("defaultTheme", () => {
	it("uses expected default colors", () => {
		expect(defaultTheme.spinner).toBe(magenta);
		expect(defaultTheme.message).toBe(bold);
		expect(defaultTheme.success).toBe(green);
		expect(defaultTheme.error).toBe(red);
	});
});

describe("resolveTheme", () => {
	it("returns defaultTheme when no overrides are present", () => {
		expect(resolveTheme()).toBe(defaultTheme);
	});

	it("merges partial overrides onto default theme", () => {
		const theme = resolveTheme({ spinner: cyan, error: yellow });
		expect(theme.spinner).toBe(cyan);
		expect(theme.error).toBe(yellow);
		expect(theme.message).toBe(bold);
		expect(theme.success).toBe(green);
	});
});

describe("createProgress", () => {
	it("resolves instance theme over defaults", () => {
		const p = createProgress({ theme: { spinner: cyan } });
		expect(p.theme.spinner).toBe(cyan);
		expect(p.theme.message).toBe(bold); // default preserved
	});

	it("with no options mirrors defaultTheme", () => {
		expect(createProgress().theme).toEqual(defaultTheme);
	});

	it("instance theme reaches indicator output", () => {
		// Indicators write to process.stderr; capture it like spinner.test.ts does.
		const originalWrite = process.stderr.write;
		let output = "";
		process.stderr.write = (chunk: string | Uint8Array) => {
			if (typeof chunk === "string") output += chunk;
			return true;
		};
		try {
			const p = createProgress({ theme: { success: (t) => `<OK ${t}>` } });
			const handle = p.progress({ message: "work", total: 2 });
			handle.start();
			handle.advance(2);
			handle.stop();
		} finally {
			process.stderr.write = originalWrite;
		}
		expect(output).toContain("<OK");
	});
});
