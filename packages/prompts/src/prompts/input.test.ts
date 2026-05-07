import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
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

	it("renders default value as placeholder when no placeholder is set", async () => {
		const promise = input({
			message: "Name?",
			default: "World",
		});

		await tick();
		// Default is shown as placeholder text, not as a (hint)
		expect(stderrOutput).toContain("World");
		expect(stderrOutput).not.toContain("(World)");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders default hint when both placeholder and default are set", async () => {
		const promise = input({
			message: "Name?",
			placeholder: "Enter your name",
			default: "World",
		});

		await tick();
		expect(stderrOutput).toContain("Enter your name");
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
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("input — no message", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("renders default message when message is omitted", async () => {
		const promise = input({});

		await tick();
		expect(stderrOutput).toContain("Enter a value");
		expect(stderrOutput).not.toContain("undefined");

		pressKey("A");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("A");
	});

	it("renders placeholder with default message", async () => {
		const promise = input({ placeholder: "Enter name" });

		await tick();
		expect(stderrOutput).toContain("Enter a value");
		expect(stderrOutput).toContain("Enter name");
		expect(stderrOutput).not.toContain("undefined");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders default as placeholder with default message", async () => {
		const promise = input({ default: "World" });

		await tick();
		expect(stderrOutput).toContain("Enter a value");
		// Default shown as placeholder, not hint
		expect(stderrOutput).toContain("World");
		expect(stderrOutput).not.toContain("(World)");
		expect(stderrOutput).not.toContain("undefined");

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("World");
	});

	it("submitted output shows default message", async () => {
		const promise = input({});

		await tick();
		pressKey("X");
		await tick();
		pressKey("", { name: "return" });

		await promise;
		expect(stderrOutput).toContain("Enter a value");
		expect(stderrOutput).not.toContain("undefined");
		expect(stderrOutput).toContain("X");
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

	it("returns default value in non-TTY environment", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		const result = await input({
			message: "Name?",
			default: "untitled",
		});

		expect(result).toBe("untitled");
	});

	it("throws NonInteractiveError when no default or initial in non-TTY", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		await expect(input({ message: "Name?" })).rejects.toThrow(
			"interactive terminal",
		);
	});

	it("prefers initial over default in non-TTY environment", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		const result = await input({
			message: "Name?",
			initial: "from-flag",
			default: "fallback",
		});

		expect(result).toBe("from-flag");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Standard Schema validation (TP-013)
// ────────────────────────────────────────────────────────────────────────────

describe("input — schema validation", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("resolves to string when a string schema accepts the input", async () => {
		const promise = input({
			message: "Name?",
			validate: z.string().min(3),
		});

		await tick();
		pressKey("A");
		await tick();
		pressKey("l");
		await tick();
		pressKey("i");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("Ali");
		expect(typeof result).toBe("string");
	});

	it("resolves to the schema's transformed output (number from coerce)", async () => {
		const promise = input({
			message: "Port?",
			validate: z.coerce.number().int().min(1),
		});

		await tick();
		pressKey("4");
		await tick();
		pressKey("2");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(42);
		expect(typeof result).toBe("number");
	});

	it("renders the first issue's message and waits for retry on failure", async () => {
		const promise = input({
			message: "Name?",
			validate: z.string().min(3, "Too short"),
		});

		await tick();
		pressKey("A");
		await tick();
		// Submit too-short value
		pressKey("", { name: "return" });
		await tick();

		expect(stderrOutput).toContain("Too short");

		// Add more characters and retry
		pressKey("l");
		await tick();
		pressKey("i");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("Ali");
	});

	it("falls back to 'Validation failed' when issue message is empty", async () => {
		// Custom Standard Schema that returns an empty-message issue.
		const emptyMessageSchema = {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate: (value: unknown) => {
					if (value === "ok") return { value: value as string };
					return { issues: [{ message: "" }] };
				},
			},
		};

		const promise = input({
			message: "Word?",
			validate: emptyMessageSchema,
		});

		await tick();
		pressKey("x");
		await tick();
		pressKey("", { name: "return" });
		await tick();

		expect(stderrOutput).toContain("Validation failed");

		// Clear field, type valid value, submit
		pressKey("", { name: "backspace" });
		await tick();
		pressKey("o");
		await tick();
		pressKey("k");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("ok");
	});

	it("treats `{ issues: [] }` from a non-conformant schema as success", async () => {
		// Spec only marks `issues === undefined` as success, but a malformed
		// schema returning an empty array has no actual issue to surface —
		// guarding on `?.length` prevents a phantom "Validation failed" error.
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

		const promise = input({ message: "Word?", validate: emptyIssuesSchema });

		await tick();
		pressKey("o");
		await tick();
		pressKey("k");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("ok");
		expect(stderrOutput).not.toContain("Validation failed");
	});

	it("surfaces zod's built-in issue message (no custom .message override)", async () => {
		// Sanity check that a real zod issue message reaches the renderer — we
		// derive the expected text from the same schema instead of asserting a
		// hard-coded string, so this can't accidentally pass when zod's default
		// messages change.
		const schema = z.string().min(3);
		const expectedMessage =
			schema.safeParse("a").error?.issues[0]?.message ?? "";
		expect(expectedMessage).not.toBe("");

		const promise = input({ message: "Code?", validate: schema });

		await tick();
		pressKey("a");
		await tick();
		pressKey("", { name: "return" });
		await tick();

		expect(stderrOutput).toContain(expectedMessage);

		pressKey("b");
		await tick();
		pressKey("c");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("abc");
	});

	it("awaits async schema validation", async () => {
		const asyncSchema = z.string().refine(
			async (v) => {
				await new Promise((r) => setTimeout(r, 5));
				return v === "yes";
			},
			{ message: "must be yes" },
		);

		const promise = input({ message: "Confirm?", validate: asyncSchema });

		await tick();
		pressKey("n");
		await tick();
		pressKey("o");
		await tick();
		pressKey("", { name: "return" });
		await tick(20);

		expect(stderrOutput).toContain("must be yes");

		// Clear and type valid value
		pressKey("", { name: "backspace" });
		await tick();
		pressKey("", { name: "backspace" });
		await tick();
		pressKey("y");
		await tick();
		pressKey("e");
		await tick();
		pressKey("s");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("yes");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Schema short-circuit (initial / non-TTY default) soundness
// ────────────────────────────────────────────────────────────────────────────
//
// When `validate` is a Standard Schema, `initial` and non-TTY `default` must
// flow through the schema before being returned. Otherwise the
// `Promise<Output>` overload silently leaks a raw `string`.

describe("input — schema short-circuit", () => {
	it("parses `initial` through the schema and returns the transformed output", async () => {
		const result = await input({
			message: "Port?",
			initial: "8080",
			validate: z.coerce.number().int(),
		});

		expect(result).toBe(8080);
		expect(typeof result).toBe("number");
	});

	it("throws when `initial` is rejected by the schema", async () => {
		await expect(
			input({
				message: "Port?",
				initial: "not-a-number",
				validate: z.coerce.number().int(),
			}),
		).rejects.toThrow(/initial value rejected by schema/);
	});

	it("parses non-TTY `default` through the schema and returns transformed output", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		try {
			const result = await input({
				message: "Port?",
				default: "3000",
				validate: z.coerce.number().int(),
			});

			expect(result).toBe(3000);
			expect(typeof result).toBe("number");
		} finally {
			Object.defineProperty(process.stdin, "isTTY", {
				value: originalIsTTY,
				writable: true,
				configurable: true,
			});
		}
	});

	it("throws when non-TTY `default` is rejected by the schema", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		try {
			await expect(
				input({
					message: "Port?",
					default: "abc",
					validate: z.coerce.number().int(),
				}),
			).rejects.toThrow(/default value rejected by schema/);
		} finally {
			Object.defineProperty(process.stdin, "isTTY", {
				value: originalIsTTY,
				writable: true,
				configurable: true,
			});
		}
	});
});

describe("input — schema + interactive default", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("runs schema against the default value when user submits empty", async () => {
		const promise = input({
			message: "Port?",
			default: "4000",
			validate: z.coerce.number().int(),
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(4000);
		expect(typeof result).toBe("number");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Callable Standard Schema dispatch
// ────────────────────────────────────────────────────────────────────────────
//
// The Standard Schema spec only requires the `~standard` property; some
// vendors (e.g. Effect Schema's `Schema.standardSchemaV1`) expose schemas as
// callable function-objects. Our guard must accept both shapes.

describe("input — callable Standard Schema", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("dispatches a callable schema through the schema branch", async () => {
		// Build a callable function that also has a `~standard` property.
		const callable = Object.assign((_value: unknown) => undefined, {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate: (value: unknown) => {
					if (typeof value === "string" && value.length > 0) {
						return { value: `[${value}]` };
					}
					return { issues: [{ message: "empty" }] };
				},
			},
		});

		const promise = input({ message: "Word?", validate: callable });

		await tick();
		pressKey("", { name: "return" });
		await tick();
		expect(stderrOutput).toContain("empty");

		pressKey("a");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("[a]");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Type-level inference (compile-time only — never executed at runtime)
// ────────────────────────────────────────────────────────────────────────────

async function _inputTypeInferenceTests() {
	// Schema overload — resolves to the schema's transformed Output.
	const port = await input({
		message: "?",
		validate: z.coerce.number(),
	});
	const _portIsNumber: number = port;

	// Function-validator overload — resolves to string.
	const name = await input({
		message: "?",
		validate: (v) => v.length > 0 || "required",
	});
	const _nameIsString: string = name;

	// No validate — resolves to string.
	const raw = await input({ message: "?" });
	const _rawIsString: string = raw;
}
