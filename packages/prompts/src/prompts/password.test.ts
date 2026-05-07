import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
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
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("password — no message", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("renders default message when message is omitted", async () => {
		const promise = password({});

		await tick();
		expect(stderrOutput).toContain("Enter a password");
		expect(stderrOutput).not.toContain("undefined");

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

	it("submitted output shows default message", async () => {
		const promise = password({});

		await tick();
		pressKey("x");
		await tick();
		pressKey("", { name: "return" });

		await promise;
		expect(stderrOutput).toContain("Enter a password");
		expect(stderrOutput).not.toContain("undefined");
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

// ────────────────────────────────────────────────────────────────────────────
// Standard Schema validation (TP-013)
// ────────────────────────────────────────────────────────────────────────────

describe("password — schema validation", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("resolves to string when a string schema accepts the input", async () => {
		const promise = password({
			message: "Password?",
			validate: z.string().min(3),
		});

		await tick();
		pressKey("a");
		await tick();
		pressKey("b");
		await tick();
		pressKey("c");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("abc");
		expect(typeof result).toBe("string");
	});

	it("renders the first issue's message and waits for retry on failure", async () => {
		const promise = password({
			message: "Password?",
			validate: z.string().min(3, "Too short"),
		});

		await tick();
		pressKey("a");
		await tick();
		pressKey("", { name: "return" });
		await tick();

		expect(stderrOutput).toContain("Too short");

		pressKey("b");
		await tick();
		pressKey("c");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("abc");
	});

	it("resolves to the schema's transformed output (number from coerce)", async () => {
		const promise = password({
			message: "PIN?",
			validate: z.coerce.number().int().min(1000),
		});

		await tick();
		pressKey("4");
		await tick();
		pressKey("2");
		await tick();
		pressKey("4");
		await tick();
		pressKey("2");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(4242);
		expect(typeof result).toBe("number");
	});

	it("awaits async schema validation", async () => {
		const asyncSchema = z.string().refine(
			async (v) => {
				await new Promise((r) => setTimeout(r, 5));
				return v === "open-sesame";
			},
			{ message: "wrong passphrase" },
		);

		const promise = password({
			message: "Passphrase?",
			validate: asyncSchema,
		});

		await tick();
		for (const ch of "wrong") {
			pressKey(ch);
			await tick();
		}
		pressKey("", { name: "return" });
		await tick(20);

		expect(stderrOutput).toContain("wrong passphrase");

		// Clear and type the correct value.
		for (let i = 0; i < 5; i++) {
			pressKey("", { name: "backspace" });
			await tick();
		}
		for (const ch of "open-sesame") {
			pressKey(ch);
			await tick();
		}
		pressKey("", { name: "return" });
		await tick(20);

		const result = await promise;
		expect(result).toBe("open-sesame");
	});

	it("falls back to 'Validation failed' when issue message is empty", async () => {
		const emptyMessageSchema = {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate: (value: unknown) => {
					if (value === "good") return { value: value as string };
					return { issues: [{ message: "" }] };
				},
			},
		};

		const promise = password({
			message: "Word?",
			validate: emptyMessageSchema,
		});

		await tick();
		pressKey("x");
		await tick();
		pressKey("", { name: "return" });
		await tick();

		expect(stderrOutput).toContain("Validation failed");

		pressKey("", { name: "backspace" });
		await tick();
		for (const ch of "good") {
			pressKey(ch);
			await tick();
		}
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("good");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Schema short-circuit (initial) soundness
// ────────────────────────────────────────────────────────────────────────────
//
// When `validate` is a Standard Schema, `initial` must flow through it.
// Otherwise the `Promise<Output>` overload silently leaks a raw `string`.

describe("password — schema short-circuit", () => {
	it("parses `initial` through the schema and returns transformed output", async () => {
		const result = await password({
			message: "PIN?",
			initial: "4242",
			validate: z.coerce.number().int(),
		});

		expect(result).toBe(4242);
		expect(typeof result).toBe("number");
	});

	it("throws when `initial` is rejected by the schema", async () => {
		await expect(
			password({
				message: "PIN?",
				initial: "abc",
				validate: z.coerce.number().int(),
			}),
		).rejects.toThrow(/initial value rejected by schema/);
	});

	it("treats `{ issues: [] }` from a non-conformant schema as success", async () => {
		// Spec only marks `issues === undefined` as success, but a malformed
		// schema returning an empty array has no actual issue to surface —
		// guarding on `?.length` prevents a phantom rejection of the
		// short-circuit `initial` value.
		const emptyIssuesSchema = {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate: (value: unknown) => ({
					value: value as string,
					issues: [] as const,
				}),
			},
		};

		const result = await password({
			message: "Word?",
			initial: "ok",
			validate: emptyIssuesSchema,
		});

		expect(result).toBe("ok");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Secrecy — raw value never appears in rendered output
// ────────────────────────────────────────────────────────────────────────────
//
// The masking comment in the rendering test only said the raw value
// shouldn't appear; it never asserted that. Tighten across the schema
// rejection and submission paths so a regression is loud.

describe("password — secrecy", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	// A unique, unlikely-to-appear-in-prompt-chrome marker so any leak fails
	// the assertion deterministically.
	const SECRET = "hunter2-XYZ";

	it("never renders the raw value while typing or after submission", async () => {
		const promise = password({ message: "Password?" });

		await tick();
		for (const ch of SECRET) {
			pressKey(ch);
			await tick();
		}
		pressKey("", { name: "return" });
		await promise;

		expect(stderrOutput).not.toContain(SECRET);
	});

	it("never renders the raw value when schema validation rejects", async () => {
		const promise = password({
			message: "Password?",
			validate: z.string().min(64, "too short"),
		});

		await tick();
		for (const ch of SECRET) {
			pressKey(ch);
			await tick();
		}
		pressKey("", { name: "return" });
		await tick();

		expect(stderrOutput).toContain("too short");
		expect(stderrOutput).not.toContain(SECRET);

		// Resolve the prompt cleanly with a long-enough valid value.
		for (let i = 0; i < SECRET.length; i++) {
			pressKey("", { name: "backspace" });
			await tick();
		}
		for (const ch of "x".repeat(64)) {
			pressKey(ch);
			await tick();
		}
		pressKey("", { name: "return" });
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Type-level inference (compile-time only — never executed at runtime)
// ────────────────────────────────────────────────────────────────────────────

async function _passwordTypeInferenceTests() {
	// Schema overload — resolves to the schema's transformed Output.
	const pin = await password({
		message: "?",
		validate: z.coerce.number(),
	});
	const _pinIsNumber: number = pin;

	// Function-validator overload — resolves to string.
	const secret = await password({
		message: "?",
		validate: (v) => v.length >= 8 || "too short",
	});
	const _secretIsString: string = secret;

	// No validate — resolves to string.
	const raw = await password({ message: "?" });
	const _rawIsString: string = raw;
}
