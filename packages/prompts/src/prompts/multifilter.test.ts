import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { multifilter } from "./multifilter.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

const originalIsTTY = process.stdin.isTTY;
const originalSetRawMode = process.stdin.setRawMode;
const originalIsRaw = process.stdin.isRaw;
const originalStderrWrite = process.stderr.write;

let stderrOutput: string;

function setupMocks(): void {
	stderrOutput = "";

	process.stderr.write = ((chunk: string | Uint8Array) => {
		if (typeof chunk === "string") {
			stderrOutput += chunk;
		}
		return true;
	}) as typeof process.stderr.write;

	Object.defineProperty(process.stdin, "isTTY", {
		value: true,
		writable: true,
		configurable: true,
	});

	// biome-ignore lint/suspicious/noExplicitAny: mocking process.stdin methods for testing
	(process.stdin as any).setRawMode = (mode: boolean) => {
		Object.defineProperty(process.stdin, "isRaw", {
			value: mode,
			writable: true,
			configurable: true,
		});
		return process.stdin;
	};
}

function restoreMocks(): void {
	Object.defineProperty(process.stdin, "isTTY", {
		value: originalIsTTY,
		writable: true,
		configurable: true,
	});
	Object.defineProperty(process.stdin, "isRaw", {
		value: originalIsRaw,
		writable: true,
		configurable: true,
	});
	if (originalSetRawMode) {
		process.stdin.setRawMode = originalSetRawMode;
	}
	process.stderr.write = originalStderrWrite;
	process.stdin.removeAllListeners("keypress");
}

function pressKey(
	char: string,
	key?: Partial<{
		name: string;
		ctrl: boolean;
		meta: boolean;
		shift: boolean;
	}>,
): void {
	process.stdin.emit("keypress", char, {
		name: key?.name ?? char,
		ctrl: key?.ctrl ?? false,
		meta: key?.meta ?? false,
		shift: key?.shift ?? false,
	});
}

function tick(ms = 10): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ────────────────────────────────────────────────────────────────────────────
// Initial/default short-circuits
// ────────────────────────────────────────────────────────────────────────────

describe("multifilter — initial / default", () => {
	it("returns initial array immediately without rendering", async () => {
		const result = await multifilter({
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
			initial: ["Rust", "JavaScript"],
		});

		expect(result).toEqual(["Rust", "JavaScript"]);
	});

	it("returns initial for object choices", async () => {
		const result = await multifilter<number>({
			message: "Ports",
			choices: [
				{ label: "HTTP", value: 80 },
				{ label: "HTTPS", value: 443 },
			],
			initial: [443, 80],
		});

		expect(result).toEqual([443, 80]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("multifilter — non-TTY", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("returns default array in non-TTY environment", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		const result = await multifilter({
			message: "Search",
			choices: ["a", "b", "c"],
			default: ["b", "c"],
		});

		expect(result).toEqual(["b", "c"]);
	});

	it("throws NonInteractiveError when no default or initial in non-TTY", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		await expect(
			multifilter({
				message: "Search",
				choices: ["a", "b", "c"],
			}),
		).rejects.toThrow("interactive terminal");
	});

	it("prefers initial over default in non-TTY environment", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		const result = await multifilter({
			message: "Search",
			choices: ["a", "b", "c"],
			initial: ["a"],
			default: ["c"],
		});

		expect(result).toEqual(["a"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Interactive behavior
// ────────────────────────────────────────────────────────────────────────────

describe("multifilter — interactive", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("Space toggles selection; Enter submits values in choice order", async () => {
		const promise = multifilter({
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		pressKey("", { name: "space" });
		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["alpha", "beta"]);
	});

	it("pre-selects from default", async () => {
		const promise = multifilter({
			message: "Search",
			choices: ["a", "b", "c"],
			default: ["c"],
		});

		await tick();
		expect(stderrOutput).toContain("●");
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["c"]);
	});

	it("Enter with required and no selection shows error", async () => {
		const promise = multifilter({
			message: "Search",
			choices: ["x", "y"],
			required: true,
		});

		await tick();
		pressKey("", { name: "return" });
		await tick();

		expect(stderrOutput).toContain("At least one");

		pressKey("", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["x"]);
	});

	it("keeps selections when query filters the list", async () => {
		const promise = multifilter({
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "space" });
		await tick();
		pressKey("g", { name: "g" });
		await tick();
		pressKey("a", { name: "a" });
		await tick();
		pressKey("m", { name: "m" });
		await tick();

		expect(stderrOutput).toContain("gamma");
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["gamma"]);
	});
});
