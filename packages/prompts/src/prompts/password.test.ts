import { describe, expect, it } from "bun:test";

import { z } from "zod";

import type { PromptIO } from "../core/renderer.ts";
import { createPromptIO, renderPrompt, type RenderedPrompt } from "../testing.ts";
import { password, type PasswordOptions } from "./password.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

let activePrompt: Pick<RenderedPrompt<unknown>, "type" | "keys" | "screen">;

function runPassword<Output>(
	options: PasswordOptions<Output>,
	io?: PromptIO,
): Promise<Output | string> {
	if (options.schema) return password(options, io);
	return password(options, io);
}

function start<Output>(options: PasswordOptions<Output>): Promise<Output | string> {
	const prompt = renderPrompt<PasswordOptions<Output>, Output | string>(runPassword, options);
	activePrompt = prompt;
	return prompt.answer;
}

function pressKey(
	char: string,
	key?: Partial<{ name: string; ctrl: boolean; meta: boolean; shift: boolean }>,
): void {
	if (key?.ctrl) {
		activePrompt.keys(`ctrl+${key.name ?? char}`);
	} else if (char === "") {
		activePrompt.keys(key?.name ?? "");
	} else {
		activePrompt.type(char);
	}
}

function screen(): string {
	return activePrompt.screen();
}

function tick(ms = 10): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForScreen(needle: string, timeout = 500): Promise<void> {
	const start = Date.now();
	while (!screen().includes(needle)) {
		if (Date.now() - start > timeout) {
			throw new Error(
				`screen never contained ${JSON.stringify(needle)} within ${timeout}ms. ` +
					`Got: ${JSON.stringify(screen())}`,
			);
		}
		await tick(5);
	}
}

function nonTTYIO() {
	return createPromptIO({ isTTY: false }).io;
}

// ────────────────────────────────────────────────────────────────────────────
// Initial value — empty-string edge case
// ────────────────────────────────────────────────────────────────────────────

// Guards the `options.initial !== undefined` semantics against a regression to
// a truthy check (which would treat "" as absent and drop into interactive mode).
// Happy-path (non-empty initial) is covered by the non-TTY initial-value test.
describe("password — initial value", () => {
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
	it("renders message on initial display", async () => {
		const promise = start({ message: "Enter password:" });

		await tick();
		expect(screen()).toContain("Enter password:");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders mask characters instead of actual value", async () => {
		const promise = start({ message: "Password?" });

		await tick();
		pressKey("a");
		await tick();
		pressKey("b");
		await tick();
		pressKey("c");
		await tick();

		// Should see mask characters (***) but NOT the actual value "abc"
		expect(screen()).toContain("*");
		// The actual characters should not appear in output
		// (except potentially in keypress event data, not in rendered output)

		pressKey("", { name: "return" });
		const result = await promise;
		// The actual value is returned, even though it was masked in display
		expect(result).toBe("abc");
	});

	it("supports custom mask character", async () => {
		const promise = start({ message: "Password?", mask: "●" });

		await tick();
		pressKey("x");
		await tick();
		pressKey("y");
		await tick();

		// Custom mask character should appear in output
		expect(screen()).toContain("●");

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("xy");
	});

	it("shows fixed-length mask on submission regardless of actual length", async () => {
		const promise = start({ message: "Password?" });

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
		expect(screen()).toContain("****");
	});

	it("shows cursor indicator when input is empty", async () => {
		const promise = start({ message: "Password?" });

		await tick();
		// U+2502 (│) is the cursor character
		expect(screen()).toContain("\u2502");

		pressKey("", { name: "return" });
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

describe("password — validation", () => {
	it("shows error message when validation fails", async () => {
		const promise = start({
			message: "Password?",
			validate: (v) => {
				if (v.length < 4) throw new Error("Password must be at least 4 characters");
			},
		});

		await tick();
		pressKey("a");
		await tick();
		pressKey("b");
		await tick();
		// Try to submit invalid value (too short)
		pressKey("", { name: "return" });
		await tick();

		expect(screen()).toContain("Password must be at least 4 characters");

		// Type more and resubmit
		pressKey("c");
		await tick();
		pressKey("d");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("abcd");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("password — no message", () => {
	it("renders default message when message is omitted", async () => {
		const promise = start({});

		await tick();
		expect(screen()).toContain("Enter a password");
		expect(screen()).not.toContain("undefined");

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
		const promise = start({});

		await tick();
		pressKey("x");
		await tick();
		pressKey("", { name: "return" });

		await promise;
		expect(screen()).toContain("Enter a password");
		expect(screen()).not.toContain("undefined");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("password — non-TTY", () => {
	function nonTTY<Output>(options: PasswordOptions<Output>): Promise<Output | string> {
		return runPassword(options, nonTTYIO());
	}

	it("throws NonInteractiveError when stdin is not a TTY", async () => {
		await expect(nonTTY({ message: "Password?" })).rejects.toThrow("interactive terminal");
	});

	it("returns initial value in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Password?",
			initial: "secret123",
		});

		expect(result).toBe("secret123");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Standard Schema validation
// ────────────────────────────────────────────────────────────────────────────

describe("password — schema validation", () => {
	it("rejects combining schema with a function validator", async () => {
		await expect(password({ schema: z.string(), validate: () => {} } as any)).rejects.toThrow(
			'password() cannot combine "schema" with "validate"',
		);
	});

	it("resolves to the schema's transformed output (number from coerce)", async () => {
		const promise = start({
			message: "PIN?",
			schema: z.coerce.number().int().min(1000),
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
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Schema short-circuit (initial) soundness
// ────────────────────────────────────────────────────────────────────────────
//
// When `schema` is present, `initial` must flow through it.
// Otherwise the `Promise<Output>` overload silently leaks a raw `string`.

describe("password — schema short-circuit", () => {
	it("parses `initial` through the schema and returns transformed output", async () => {
		const result = await password({
			message: "PIN?",
			initial: "4242",
			schema: z.coerce.number().int(),
		});

		expect(result).toBe(4242);
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
				validate: <Value>(_value: Value) => ({
					value: "ok",
					issues: [] as const,
				}),
			},
		};

		const result = await password({
			message: "Word?",
			initial: "ok",
			schema: emptyIssuesSchema,
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
	// A unique, unlikely-to-appear-in-prompt-chrome marker so any leak fails
	// the assertion deterministically.
	const SECRET = "hunter2-XYZ";

	it("never renders the raw value while typing or after submission", async () => {
		const promise = start({ message: "Password?" });

		await tick();
		for (const ch of SECRET) {
			pressKey(ch);
			await tick();
		}
		pressKey("", { name: "return" });
		await promise;

		expect(screen()).not.toContain(SECRET);
	});

	it("never renders the raw value when schema validation rejects", async () => {
		const promise = start({
			message: "Password?",
			schema: z.string().min(64, "too short"),
		});

		await tick();
		for (const ch of SECRET) {
			pressKey(ch);
			await tick();
		}
		pressKey("", { name: "return" });
		// Schema validation is async; a fixed tick races the error render on slow runners.
		await waitForScreen("too short");

		expect(screen()).toContain("too short");
		expect(screen()).not.toContain(SECRET);

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

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

async function _passwordTypeInferenceTests() {
	// Schema overload — resolves to the schema's transformed Output.
	// Strict Equal so a regression to `any`/union cannot slip through.
	const pin = await password({
		message: "?",
		schema: z.coerce.number(),
	});
	type _PinIsNumber = Expect<Equal<typeof pin, number>>;

	// Function-validator overload — resolves to string. Throw-on-fail contract.
	const secret = await password({
		message: "?",
		validate: (v) => {
			if (v.length < 8) throw new Error("too short");
		},
	});
	type _SecretIsString = Expect<Equal<typeof secret, string>>;

	// No validate — resolves to string.
	const raw = await password({ message: "?" });
	type _RawIsString = Expect<Equal<typeof raw, string>>;

	const schemaInWrongSlot = z.string();
	// @ts-expect-error — Standard Schemas belong in `schema`, not `validate`
	void password({ validate: schemaInWrongSlot });
	// @ts-expect-error — schema and validate are exclusive
	void password({ schema: z.string(), validate: () => {} });
}
