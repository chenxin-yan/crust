import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { input } from "./input.ts";

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
	key?: Partial<{ name: string; ctrl: boolean; meta: boolean; shift: boolean }>,
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

describe("input — initial value", () => {
	it("returns initial value immediately without rendering", async () => {
		const result = await input({
			message: "Name?",
			initial: "Alice",
		});

		expect(result).toBe("Alice");
	});

	it("returns empty string initial value", async () => {
		const result = await input({
			message: "Name?",
			initial: "",
		});

		expect(result).toBe("");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Interactive behavior
// ────────────────────────────────────────────────────────────────────────────

describe("input — interactive", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("renders message on initial display", async () => {
		const promise = input({ message: "Your name?" });

		await tick();
		expect(stderrOutput).toContain("Your name?");

		// Submit empty to resolve
		pressKey("", { name: "return" });
		await promise;
	});

	it("renders placeholder when no value entered", async () => {
		const promise = input({
			message: "Name?",
			placeholder: "Enter your name",
		});

		await tick();
		expect(stderrOutput).toContain("Enter your name");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders default hint when default is set and value is empty", async () => {
		const promise = input({
			message: "Name?",
			default: "World",
		});

		await tick();
		expect(stderrOutput).toContain("(World)");

		pressKey("", { name: "return" });
		await promise;
	});

	it("submits typed value on Enter", async () => {
		const promise = input({ message: "Name?" });

		await tick();
		pressKey("A", { name: "a" });
		await tick();
		pressKey("B", { name: "b" });
		await tick();
		pressKey("C", { name: "c" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("ABC");
	});

	it("uses default value when submitting empty input", async () => {
		const promise = input({
			message: "Name?",
			default: "DefaultName",
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("DefaultName");
	});

	it("submits typed value even when default is set", async () => {
		const promise = input({
			message: "Name?",
			default: "DefaultName",
		});

		await tick();
		pressKey("X", { name: "x" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("X");
	});

	it("renders submitted value with success styling", async () => {
		const promise = input({ message: "Name?" });

		await tick();
		pressKey("O", { name: "o" });
		await tick();
		pressKey("K", { name: "k" });
		await tick();
		pressKey("", { name: "return" });

		await promise;
		// After submission, the confirmed value should appear in output
		expect(stderrOutput).toContain("OK");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Keypress handling (editing)
// ────────────────────────────────────────────────────────────────────────────

describe("input — keypress editing", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("backspace deletes character before cursor", async () => {
		const promise = input({ message: "Name?" });

		await tick();
		pressKey("A");
		await tick();
		pressKey("B");
		await tick();
		pressKey("", { name: "backspace" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("A");
	});

	it("backspace at position 0 does nothing", async () => {
		const promise = input({ message: "Name?" });

		await tick();
		pressKey("", { name: "backspace" });
		await tick();
		pressKey("A");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("A");
	});

	it("delete removes character at cursor", async () => {
		const promise = input({ message: "Name?" });

		await tick();
		pressKey("A");
		await tick();
		pressKey("B");
		await tick();
		pressKey("C");
		await tick();
		// Move cursor left to position before C
		pressKey("", { name: "left" });
		await tick();
		pressKey("", { name: "left" });
		await tick();
		// Delete the character at cursor (B)
		pressKey("", { name: "delete" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("AC");
	});

	it("left arrow moves cursor left", async () => {
		const promise = input({ message: "Name?" });

		await tick();
		pressKey("A");
		await tick();
		pressKey("B");
		await tick();
		// Move left, then type C — inserts before B
		pressKey("", { name: "left" });
		await tick();
		pressKey("C");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("ACB");
	});

	it("right arrow moves cursor right", async () => {
		const promise = input({ message: "Name?" });

		await tick();
		pressKey("A");
		await tick();
		pressKey("B");
		await tick();
		// Move left twice, then right once — cursor is between A and B
		pressKey("", { name: "left" });
		await tick();
		pressKey("", { name: "left" });
		await tick();
		pressKey("", { name: "right" });
		await tick();
		pressKey("C");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("ACB");
	});

	it("home key jumps to start", async () => {
		const promise = input({ message: "Name?" });

		await tick();
		pressKey("A");
		await tick();
		pressKey("B");
		await tick();
		pressKey("", { name: "home" });
		await tick();
		pressKey("C");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("CAB");
	});

	it("end key jumps to end", async () => {
		const promise = input({ message: "Name?" });

		await tick();
		pressKey("A");
		await tick();
		pressKey("B");
		await tick();
		pressKey("", { name: "home" });
		await tick();
		pressKey("", { name: "end" });
		await tick();
		pressKey("C");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("ABC");
	});

	it("ignores ctrl+key combinations", async () => {
		const promise = input({ message: "Name?" });

		await tick();
		pressKey("A");
		await tick();
		// Ctrl+A should be ignored (not inserted)
		pressKey("a", { name: "a", ctrl: true });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("A");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

describe("input — validation", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("shows error message when validation fails", async () => {
		const promise = input({
			message: "Email?",
			validate: (v) => (v.includes("@") ? true : "Must contain @"),
		});

		await tick();
		pressKey("a");
		await tick();
		pressKey("b");
		await tick();
		// Try to submit invalid value
		pressKey("", { name: "return" });
		await tick();

		// Error should be displayed
		expect(stderrOutput).toContain("Must contain @");

		// Now type valid input and resubmit
		pressKey("@");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("ab@");
	});

	it("accepts valid input after correction", async () => {
		let validateCallCount = 0;

		const promise = input({
			message: "Name?",
			validate: (v) => {
				validateCallCount++;
				return v.length >= 2 ? true : "Too short";
			},
		});

		await tick();
		pressKey("A");
		await tick();
		// Submit too-short value
		pressKey("", { name: "return" });
		await tick();

		expect(stderrOutput).toContain("Too short");

		// Add more text and resubmit
		pressKey("B");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("AB");
		expect(validateCallCount).toBe(2);
	});

	it("supports async validation", async () => {
		const promise = input({
			message: "Code?",
			validate: async (v) => {
				await new Promise((r) => setTimeout(r, 5));
				return v === "1234" ? true : "Wrong code";
			},
		});

		await tick();
		pressKey("1");
		await tick();
		pressKey("2");
		await tick();
		pressKey("3");
		await tick();
		pressKey("4");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("1234");
	});

	it("validates default value when used", async () => {
		const promise = input({
			message: "Name?",
			default: "",
			validate: (v) => (v.length > 0 ? true : "Required"),
		});

		await tick();
		// Submit empty — default is "" which should fail validation
		pressKey("", { name: "return" });
		await tick();

		expect(stderrOutput).toContain("Required");

		// Type something and submit
		pressKey("X");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("X");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("input — non-TTY", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("throws NonInteractiveError when stdin is not a TTY", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		await expect(input({ message: "Name?" })).rejects.toThrow(
			"interactive terminal",
		);
	});

	it("returns initial value in non-TTY environment", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		const result = await input({
			message: "Name?",
			initial: "Bob",
		});

		expect(result).toBe("Bob");
	});
});
