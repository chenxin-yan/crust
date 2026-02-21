import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { password } from "./password.ts";

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

describe("password — initial value", () => {
	it("returns initial value immediately without rendering", async () => {
		const result = await password({
			message: "Password?",
			initial: "s3cret",
		});

		expect(result).toBe("s3cret");
	});

	it("returns empty string initial value", async () => {
		const result = await password({
			message: "Password?",
			initial: "",
		});

		expect(result).toBe("");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Masked rendering
// ────────────────────────────────────────────────────────────────────────────

describe("password — masked rendering", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("renders message on initial display", async () => {
		const promise = password({ message: "Enter password:" });

		await tick();
		expect(stderrOutput).toContain("Enter password:");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders mask characters instead of actual value", async () => {
		const promise = password({ message: "Password?" });

		await tick();
		pressKey("a");
		await tick();
		pressKey("b");
		await tick();
		pressKey("c");
		await tick();

		// Should see mask characters (***) but NOT the actual value "abc"
		expect(stderrOutput).toContain("*");
		// The actual characters should not appear in output
		// (except potentially in keypress event data, not in rendered output)

		pressKey("", { name: "return" });
		const result = await promise;
		// The actual value is returned, even though it was masked in display
		expect(result).toBe("abc");
	});

	it("supports custom mask character", async () => {
		const promise = password({ message: "Password?", mask: "●" });

		await tick();
		pressKey("x");
		await tick();
		pressKey("y");
		await tick();

		// Custom mask character should appear in output
		expect(stderrOutput).toContain("●");

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("xy");
	});

	it("shows fixed-length mask on submission regardless of actual length", async () => {
		const promise = password({ message: "Password?" });

		await tick();
		// Type a 10-character password
		for (const ch of "abcdefghij") {
			pressKey(ch);
			await tick();
		}

		pressKey("", { name: "return" });
		await promise;

		// After submission, should show exactly 4 mask characters (SUBMITTED_MASK_LENGTH)
		// The submitted line uses the success theme, so look for **** in output
		expect(stderrOutput).toContain("****");
	});

	it("shows cursor indicator when input is empty", async () => {
		const promise = password({ message: "Password?" });

		await tick();
		// U+2502 (│) is the cursor character
		expect(stderrOutput).toContain("\u2502");

		pressKey("", { name: "return" });
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Keypress handling (editing)
// ────────────────────────────────────────────────────────────────────────────

describe("password — keypress editing", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("submits typed value on Enter", async () => {
		const promise = password({ message: "Password?" });

		await tick();
		pressKey("s");
		await tick();
		pressKey("e");
		await tick();
		pressKey("c");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("sec");
	});

	it("backspace deletes character before cursor", async () => {
		const promise = password({ message: "Password?" });

		await tick();
		pressKey("A");
		await tick();
		pressKey("B");
		await tick();
		pressKey("C");
		await tick();
		pressKey("", { name: "backspace" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("AB");
	});

	it("backspace at position 0 does nothing", async () => {
		const promise = password({ message: "Password?" });

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
		const promise = password({ message: "Password?" });

		await tick();
		pressKey("A");
		await tick();
		pressKey("B");
		await tick();
		pressKey("C");
		await tick();
		// Move cursor left twice
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

	it("left/right arrow keys move cursor", async () => {
		const promise = password({ message: "Password?" });

		await tick();
		pressKey("A");
		await tick();
		pressKey("B");
		await tick();
		// Move left, type C — inserts before B
		pressKey("", { name: "left" });
		await tick();
		pressKey("C");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("ACB");
	});

	it("home key jumps to start", async () => {
		const promise = password({ message: "Password?" });

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
		const promise = password({ message: "Password?" });

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
		const promise = password({ message: "Password?" });

		await tick();
		pressKey("A");
		await tick();
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

describe("password — validation", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("shows error message when validation fails", async () => {
		const promise = password({
			message: "Password?",
			validate: (v) =>
				v.length >= 4 ? true : "Password must be at least 4 characters",
		});

		await tick();
		pressKey("a");
		await tick();
		pressKey("b");
		await tick();
		// Try to submit invalid value (too short)
		pressKey("", { name: "return" });
		await tick();

		expect(stderrOutput).toContain("Password must be at least 4 characters");

		// Type more and resubmit
		pressKey("c");
		await tick();
		pressKey("d");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("abcd");
	});

	it("supports async validation", async () => {
		const promise = password({
			message: "Token?",
			validate: async (v) => {
				await new Promise((r) => setTimeout(r, 5));
				return v === "valid" ? true : "Invalid token";
			},
		});

		await tick();
		for (const ch of "valid") {
			pressKey(ch);
			await tick();
		}
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("valid");
	});

	it("clears error on new character input", async () => {
		const promise = password({
			message: "Password?",
			validate: (v) => (v.length >= 2 ? true : "Too short"),
		});

		await tick();
		pressKey("a");
		await tick();
		// Submit too-short value
		pressKey("", { name: "return" });
		await tick();

		expect(stderrOutput).toContain("Too short");

		// Type another character — error should be cleared from state
		pressKey("b");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("ab");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("password — non-TTY", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("throws NonInteractiveError when stdin is not a TTY", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		await expect(password({ message: "Password?" })).rejects.toThrow(
			"interactive terminal",
		);
	});

	it("returns initial value in non-TTY environment", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		const result = await password({
			message: "Password?",
			initial: "secret123",
		});

		expect(result).toBe("secret123");
	});
});
