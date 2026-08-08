import { describe, expect, it } from "bun:test";

import { bold, cyan, green, magenta, red, yellow } from "@crustjs/style";

import {
	type CreateProgressOptions,
	createProgress,
	type ProgressInstance,
} from "./create-progress.ts";
import type { SpinnerHandle } from "./spinner.ts";
import { defaultTheme, resolveTheme } from "./theme.ts";

// Indicators write to process.stderr; capture it like spinner.test.ts does.
const captureStderr = (fn: () => void): string => {
	const originalWrite = process.stderr.write;
	let output = "";
	process.stderr.write = (chunk: string | Uint8Array) => {
		if (typeof chunk === "string") output += chunk;
		return true;
	};
	try {
		fn();
	} finally {
		process.stderr.write = originalWrite;
	}
	return output;
};

const runProgress = (p: ProgressInstance, message: string): void => {
	const handle = p.progress({ message, total: 1 });
	handle.start();
	handle.advance(1);
	handle.stop();
};

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

	it("instances are isolated from each other", () => {
		// The `message` slot wraps the message text, e.g. `✓ <A a-work (1/1)>`.
		const captured = captureStderr(() => {
			const a = createProgress({ theme: { message: (t) => `<A ${t}>` } });
			const b = createProgress({ theme: { message: (t) => `<B ${t}>` } });
			runProgress(a, "a-work");
			runProgress(b, "b-work");
			runProgress(a, "a-again");
		});
		expect(captured).toContain("<A a-work");
		expect(captured).toContain("<B b-work");
		expect(captured).toContain("<A a-again");
		expect(captured).not.toContain("<B a-work");
		expect(captured).not.toContain("<A b-work");
	});

	it("merges default ← instance ← per-call, keeping instance-only slots", () => {
		const p = createProgress({
			theme: { success: (t) => `<INST ${t}>`, message: (t) => `[MSG ${t}]` },
		});
		const captured = captureStderr(() => {
			const handle = p.progress({
				message: "work",
				total: 1,
				theme: { success: (t) => `<CALL ${t}>` },
			});
			handle.start();
			handle.advance(1);
			handle.stop();
		});
		expect(captured).toContain("<CALL"); // per-call wins the conflicting slot
		expect(captured).toContain("[MSG work"); // instance-only slot survives
		expect(captured).not.toContain("<INST");
	});

	it("snapshots overrides at creation; later mutation has no effect", () => {
		const overrides = { success: (t: string) => `<ORIG ${t}>` };
		const p = createProgress({ theme: overrides });
		overrides.success = (t: string) => `<MUTATED ${t}>`;
		const captured = captureStderr(() => runProgress(p, "work"));
		// `success` styles the ✓ glyph on the final line.
		expect(captured).toContain("<ORIG");
		expect(captured).not.toContain("<MUTATED");
		expect(p.theme.success("x")).toBe("<ORIG x>");
	});

	it("instance theme reaches indicator output", () => {
		const p = createProgress({ theme: { success: (t) => `<OK ${t}>` } });
		const output = captureStderr(() => runProgress(p, "work"));
		expect(output).toContain("<OK");
	});

	it("bound spinner preserves the task/handle overloads (compile-time)", () => {
		// Never executed — these arrows only need to type-check. They guard the
		// casts in create-progress.ts against drifting from spinner's overloads.
		const _opts: CreateProgressOptions = { theme: {} };
		const p = null as unknown as ProgressInstance;
		const assertTask = (): Promise<number> => p.spinner({ message: "m", task: async () => 42 });
		const assertHandle = (): SpinnerHandle => p.spinner({ message: "m" });
		void _opts;
		void assertTask;
		void assertHandle;
		expect(true).toBe(true);
	});
});
