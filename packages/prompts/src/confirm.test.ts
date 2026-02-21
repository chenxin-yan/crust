import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { confirm } from "./confirm.ts";

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

/**
 * Emit a keypress event on stdin.
 */
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

/**
 * Wait briefly for async event processing.
 */
function tick(ms = 10): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ────────────────────────────────────────────────────────────────────────────
// Initial value short-circuit
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — initial value", () => {
	it("returns initial value true immediately without rendering", async () => {
		const result = await confirm({
			message: "Continue?",
			initial: true,
		});

		expect(result).toBe(true);
	});

	it("returns initial value false immediately without rendering", async () => {
		const result = await confirm({
			message: "Continue?",
			initial: false,
		});

		expect(result).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Default value
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — default value", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("defaults to true when no default is specified", async () => {
		const promise = confirm({ message: "Continue?" });

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(true);
	});

	it("uses default: false when specified", async () => {
		const promise = confirm({
			message: "Continue?",
			default: false,
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});

	it("uses default: true when specified", async () => {
		const promise = confirm({
			message: "Continue?",
			default: true,
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Toggle behavior
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — toggle", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("left arrow toggles value", async () => {
		const promise = confirm({ message: "Continue?" });

		await tick();
		// Default is true, left should toggle to false
		pressKey("", { name: "left" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});

	it("right arrow toggles value", async () => {
		const promise = confirm({ message: "Continue?" });

		await tick();
		// Default is true, right should toggle to false
		pressKey("", { name: "right" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});

	it("tab toggles value", async () => {
		const promise = confirm({ message: "Continue?" });

		await tick();
		// Default is true, tab should toggle to false
		pressKey("", { name: "tab" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});

	it("double toggle returns to original value", async () => {
		const promise = confirm({ message: "Continue?" });

		await tick();
		// Toggle twice — should be back to true
		pressKey("", { name: "left" });
		await tick();
		pressKey("", { name: "right" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Keyboard shortcuts
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — shortcuts", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("y key sets value to true", async () => {
		const promise = confirm({
			message: "Continue?",
			default: false,
		});

		await tick();
		pressKey("y");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(true);
	});

	it("Y key sets value to true", async () => {
		const promise = confirm({
			message: "Continue?",
			default: false,
		});

		await tick();
		pressKey("Y", { name: "y", shift: true });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(true);
	});

	it("n key sets value to false", async () => {
		const promise = confirm({ message: "Continue?" });

		await tick();
		pressKey("n");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});

	it("N key sets value to false", async () => {
		const promise = confirm({ message: "Continue?" });

		await tick();
		pressKey("N", { name: "n", shift: true });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});

	it("h key sets value to true (yes/active)", async () => {
		const promise = confirm({
			message: "Continue?",
			default: false,
		});

		await tick();
		pressKey("h", { name: "h" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(true);
	});

	it("l key sets value to false (no/inactive)", async () => {
		const promise = confirm({ message: "Continue?" });

		await tick();
		pressKey("l", { name: "l" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Custom labels
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — custom labels", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("renders custom active and inactive labels", async () => {
		const promise = confirm({
			message: "Accept terms?",
			active: "Agree",
			inactive: "Decline",
		});

		await tick();
		expect(stderrOutput).toContain("Agree");
		expect(stderrOutput).toContain("Decline");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders default Yes/No labels when not customized", async () => {
		const promise = confirm({ message: "Continue?" });

		await tick();
		expect(stderrOutput).toContain("Yes");
		expect(stderrOutput).toContain("No");

		pressKey("", { name: "return" });
		await promise;
	});

	it("shows selected custom label on submit", async () => {
		const promise = confirm({
			message: "Accept?",
			active: "Accept",
			inactive: "Reject",
			default: false,
		});

		await tick();
		// Toggle to true (Accept)
		pressKey("y");
		await tick();
		pressKey("", { name: "return" });

		await promise;
		expect(stderrOutput).toContain("Accept");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — rendering", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("renders message on initial display", async () => {
		const promise = confirm({ message: "Deploy to production?" });

		await tick();
		expect(stderrOutput).toContain("Deploy to production?");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders separator between options", async () => {
		const promise = confirm({ message: "Continue?" });

		await tick();
		expect(stderrOutput).toContain(" / ");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders submitted answer on confirm", async () => {
		const promise = confirm({ message: "Continue?" });

		await tick();
		pressKey("n");
		await tick();
		pressKey("", { name: "return" });

		await promise;
		// After submission, the selected answer should appear
		expect(stderrOutput).toContain("No");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — non-TTY", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("throws NonInteractiveError when stdin is not a TTY", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		await expect(confirm({ message: "Continue?" })).rejects.toThrow(
			"interactive terminal",
		);
	});

	it("returns initial value in non-TTY environment", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		const result = await confirm({
			message: "Continue?",
			initial: false,
		});

		expect(result).toBe(false);
	});
});
