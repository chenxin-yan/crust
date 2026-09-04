import { describe, expect, it } from "bun:test";

import { z } from "zod";

import { pressKey, renderPrompt } from "../testing.ts";
import { input } from "./input.ts";
import { nonTTYIO, tick, waitForScreen } from "./test-helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Initial value — empty-string edge case
// ────────────────────────────────────────────────────────────────────────────

// Guards the `options.initial !== undefined` semantics against a regression to
// a truthy check (which would treat "" as absent and drop into interactive mode).
// Happy-path (non-empty initial) is covered by the non-TTY initial-value test.
describe("input — initial value", () => {
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
	it("renders message on initial display", async () => {
		const prompt = renderPrompt(input, { message: "Your name?" });

		await tick();
		expect(prompt.screen()).toContain("Your name?");

		// Submit empty to resolve
		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("renders placeholder when no value entered", async () => {
		const prompt = renderPrompt(input, {
			message: "Name?",
			placeholder: "Enter your name",
		});

		await tick();
		expect(prompt.screen()).toContain("Enter your name");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("renders default value as placeholder when no placeholder is set", async () => {
		const prompt = renderPrompt(input, {
			message: "Name?",
			default: "World",
		});

		await tick();
		// Default is shown as placeholder text, not as a (hint)
		expect(prompt.screen()).toContain("World");
		expect(prompt.screen()).not.toContain("(World)");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("renders default hint when both placeholder and default are set", async () => {
		const prompt = renderPrompt(input, {
			message: "Name?",
			placeholder: "Enter your name",
			default: "World",
		});

		await tick();
		expect(prompt.screen()).toContain("Enter your name");
		expect(prompt.screen()).toContain("(World)");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("submits typed value on Enter", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		pressKey(prompt, "A", { name: "a" });
		await tick();
		pressKey(prompt, "B", { name: "b" });
		await tick();
		pressKey(prompt, "C", { name: "c" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("ABC");
	});

	it("uses default value when submitting empty input", async () => {
		const prompt = renderPrompt(input, {
			message: "Name?",
			default: "DefaultName",
		});

		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("DefaultName");
	});

	it("submits typed value even when default is set", async () => {
		const prompt = renderPrompt(input, {
			message: "Name?",
			default: "DefaultName",
		});

		await tick();
		pressKey(prompt, "X", { name: "x" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("X");
	});

	it("renders submitted value with success styling", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		pressKey(prompt, "O", { name: "o" });
		await tick();
		pressKey(prompt, "K", { name: "k" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		await prompt.answer;
		// After submission, the confirmed value should appear in output
		expect(prompt.screen()).toContain("OK");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Keypress handling (editing)
// ────────────────────────────────────────────────────────────────────────────

describe("input — keypress editing", () => {
	it("backspace deletes character before cursor", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		pressKey(prompt, "A");
		await tick();
		pressKey(prompt, "B");
		await tick();
		pressKey(prompt, "", { name: "backspace" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("A");
	});

	it("backspace at position 0 does nothing", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		pressKey(prompt, "", { name: "backspace" });
		await tick();
		pressKey(prompt, "A");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("A");
	});

	it("delete removes character at cursor", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		pressKey(prompt, "A");
		await tick();
		pressKey(prompt, "B");
		await tick();
		pressKey(prompt, "C");
		await tick();
		// Move cursor left to position before C
		pressKey(prompt, "", { name: "left" });
		await tick();
		pressKey(prompt, "", { name: "left" });
		await tick();
		// Delete the character at cursor (B)
		pressKey(prompt, "", { name: "delete" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("AC");
	});

	it("left arrow moves cursor left", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		pressKey(prompt, "A");
		await tick();
		pressKey(prompt, "B");
		await tick();
		// Move left, then type C — inserts before B
		pressKey(prompt, "", { name: "left" });
		await tick();
		pressKey(prompt, "C");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("ACB");
	});

	it("right arrow moves cursor right", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		pressKey(prompt, "A");
		await tick();
		pressKey(prompt, "B");
		await tick();
		// Move left twice, then right once — cursor is between A and B
		pressKey(prompt, "", { name: "left" });
		await tick();
		pressKey(prompt, "", { name: "left" });
		await tick();
		pressKey(prompt, "", { name: "right" });
		await tick();
		pressKey(prompt, "C");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("ACB");
	});

	it("home key jumps to start", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		pressKey(prompt, "A");
		await tick();
		pressKey(prompt, "B");
		await tick();
		pressKey(prompt, "", { name: "home" });
		await tick();
		pressKey(prompt, "C");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("CAB");
	});

	it("end key jumps to end", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		pressKey(prompt, "A");
		await tick();
		pressKey(prompt, "B");
		await tick();
		pressKey(prompt, "", { name: "home" });
		await tick();
		pressKey(prompt, "", { name: "end" });
		await tick();
		pressKey(prompt, "C");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("ABC");
	});

	it("ignores ctrl+key combinations", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		pressKey(prompt, "A");
		await tick();
		// Ctrl+A should be ignored (not inserted)
		pressKey(prompt, "a", { name: "a", ctrl: true });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("A");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

describe("input — validation", () => {
	it("shows error message when validation fails", async () => {
		const prompt = renderPrompt(input, {
			message: "Email?",
			validate: (v) => {
				if (!v.includes("@")) throw new Error("Must contain @");
			},
		});

		await tick();
		pressKey(prompt, "a");
		await tick();
		pressKey(prompt, "b");
		await tick();
		// Try to submit invalid value
		pressKey(prompt, "", { name: "return" });
		await tick();

		// Error should be displayed
		expect(prompt.screen()).toContain("Must contain @");

		// Now type valid input and resubmit
		pressKey(prompt, "@");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("ab@");
	});

	it("accepts valid input after correction", async () => {
		let validateCallCount = 0;

		const prompt = renderPrompt(input, {
			message: "Name?",
			validate: (v) => {
				validateCallCount++;
				if (v.length < 2) throw new Error("Too short");
			},
		});

		await tick();
		pressKey(prompt, "A");
		await tick();
		// Submit too-short value
		pressKey(prompt, "", { name: "return" });
		await tick();

		expect(prompt.screen()).toContain("Too short");

		// Add more text and resubmit
		pressKey(prompt, "B");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("AB");
		expect(validateCallCount).toBe(2);
	});

	it("supports async validation", async () => {
		const prompt = renderPrompt(input, {
			message: "Code?",
			validate: async (v) => {
				await new Promise((r) => setTimeout(r, 5));
				if (v !== "1234") throw new Error("Wrong code");
			},
		});

		await tick();
		pressKey(prompt, "1");
		await tick();
		pressKey(prompt, "2");
		await tick();
		pressKey(prompt, "3");
		await tick();
		pressKey(prompt, "4");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("1234");
	});

	it("validates default value when used", async () => {
		const prompt = renderPrompt(input, {
			message: "Name?",
			default: "",
			validate: (v) => {
				if (v.length === 0) throw new Error("Required");
			},
		});

		await tick();
		// Submit empty — default is "" which should fail validation
		pressKey(prompt, "", { name: "return" });
		await tick();

		expect(prompt.screen()).toContain("Required");

		// Type something and submit
		pressKey(prompt, "X");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("X");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("input — no message", () => {
	it("renders default message when message is omitted", async () => {
		const prompt = renderPrompt(input, {});

		await tick();
		expect(prompt.screen()).toContain("Enter a value");
		expect(prompt.screen()).not.toContain("undefined");

		pressKey(prompt, "A");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("A");
	});

	it("submitted output shows default message", async () => {
		const prompt = renderPrompt(input, {});

		await tick();
		pressKey(prompt, "X");
		await tick();
		pressKey(prompt, "", { name: "return" });

		await prompt.answer;
		expect(prompt.screen()).toContain("Enter a value");
		expect(prompt.screen()).not.toContain("undefined");
		expect(prompt.screen()).toContain("X");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("input — non-TTY", () => {
	it("returns initial value in non-TTY environment", async () => {
		const result = await input({ message: "Name?", initial: "Bob" }, nonTTYIO());

		expect(result).toBe("Bob");
	});

	it("returns default value in non-TTY environment", async () => {
		const result = await input({ message: "Name?", default: "untitled" }, nonTTYIO());

		expect(result).toBe("untitled");
	});

	it("throws NonInteractiveError when no default or initial in non-TTY", async () => {
		await expect(input({ message: "Name?" }, nonTTYIO())).rejects.toThrow("interactive terminal");
	});

	it("prefers initial over default in non-TTY environment", async () => {
		const result = await input(
			{ message: "Name?", initial: "from-flag", default: "fallback" },
			nonTTYIO(),
		);

		expect(result).toBe("from-flag");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Standard Schema validation
// ────────────────────────────────────────────────────────────────────────────

describe("input — schema validation", () => {
	it("rejects combining schema with a function validator", async () => {
		await expect(input({ schema: z.string(), validate: () => {} } as never)).rejects.toThrow(
			'input() cannot combine "schema" with "validate"',
		);
	});

	it("resolves to string when a string schema accepts the input", async () => {
		const prompt = renderPrompt(input<string>, {
			message: "Name?",
			schema: z.string().min(3),
		});

		await tick();
		pressKey(prompt, "A");
		await tick();
		pressKey(prompt, "l");
		await tick();
		pressKey(prompt, "i");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("Ali");
	});

	it("resolves to the schema's transformed output (number from coerce)", async () => {
		const prompt = renderPrompt(input<number>, {
			message: "Port?",
			schema: z.coerce.number().int().min(1),
		});

		await tick();
		pressKey(prompt, "4");
		await tick();
		pressKey(prompt, "2");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe(42);
	});

	it("renders the first issue's message and waits for retry on failure", async () => {
		const prompt = renderPrompt(input<string>, {
			message: "Name?",
			schema: z.string().min(3, "Too short"),
		});

		await tick();
		pressKey(prompt, "A");
		await tick();
		// Submit too-short value
		pressKey(prompt, "", { name: "return" });
		await tick();

		expect(prompt.screen()).toContain("Too short");

		// Add more characters and retry
		pressKey(prompt, "l");
		await tick();
		pressKey(prompt, "i");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("Ali");
	});

	it("falls back to 'Validation failed' when issue message is empty", async () => {
		// Custom Standard Schema that returns an empty-message issue.
		const emptyMessageSchema = {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate: <Value>(value: Value) => {
					if (value === "ok") return { value: "ok" };
					return { issues: [{ message: "" }] };
				},
			},
		};

		const prompt = renderPrompt(input<string>, {
			message: "Word?",
			schema: emptyMessageSchema,
		});

		await tick();
		pressKey(prompt, "x");
		await tick();
		pressKey(prompt, "", { name: "return" });
		await tick();

		expect(prompt.screen()).toContain("Validation failed");

		// Clear field, type valid value, submit
		pressKey(prompt, "", { name: "backspace" });
		await tick();
		pressKey(prompt, "o");
		await tick();
		pressKey(prompt, "k");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
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
				validate: <Value>(_value: Value) => ({
					value: "ok",
					issues: [] as const,
				}),
			},
		};

		const prompt = renderPrompt(input<string>, { message: "Word?", schema: emptyIssuesSchema });

		await tick();
		pressKey(prompt, "o");
		await tick();
		pressKey(prompt, "k");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("ok");
		expect(prompt.screen()).not.toContain("Validation failed");
	});

	it("awaits async schema validation", async () => {
		const asyncSchema = z.string().refine(
			async (v) => {
				await new Promise((r) => setTimeout(r, 5));
				return v === "yes";
			},
			{ message: "must be yes" },
		);

		const prompt = renderPrompt(input<string>, { message: "Confirm?", schema: asyncSchema });

		await tick();
		pressKey(prompt, "n");
		await tick();
		pressKey(prompt, "o");
		await tick();
		pressKey(prompt, "", { name: "return" });
		await waitForScreen(prompt, "must be yes");

		expect(prompt.screen()).toContain("must be yes");

		// Clear and type valid value
		pressKey(prompt, "", { name: "backspace" });
		await tick();
		pressKey(prompt, "", { name: "backspace" });
		await tick();
		pressKey(prompt, "y");
		await tick();
		pressKey(prompt, "e");
		await tick();
		pressKey(prompt, "s");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("yes");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Schema short-circuit (initial / non-TTY default) soundness
// ────────────────────────────────────────────────────────────────────────────
//
// When `schema` is present, `initial` and non-TTY `default` must
// flow through the schema before being returned. Otherwise the
// `Promise<Output>` overload silently leaks a raw `string`.

describe("input — schema short-circuit", () => {
	it("parses `initial` through the schema and returns the transformed output", async () => {
		const result = await input({
			message: "Port?",
			initial: "8080",
			schema: z.coerce.number().int(),
		});

		expect(result).toBe(8080);
	});

	it("throws when `initial` is rejected by the schema", async () => {
		await expect(
			input({
				message: "Port?",
				initial: "not-a-number",
				schema: z.coerce.number().int(),
			}),
		).rejects.toThrow(/initial value rejected by schema/);
	});

	it("parses non-TTY `default` through the schema and returns transformed output", async () => {
		const result = await input(
			{
				message: "Port?",
				default: "3000",
				schema: z.coerce.number().int(),
			},
			nonTTYIO(),
		);

		expect(result).toBe(3000);
	});

	it("throws when non-TTY `default` is rejected by the schema", async () => {
		await expect(
			input(
				{
					message: "Port?",
					default: "abc",
					schema: z.coerce.number().int(),
				},
				nonTTYIO(),
			),
		).rejects.toThrow(/default value rejected by schema/);
	});
});

describe("input — schema + interactive default", () => {
	it("runs schema against the default value when user submits empty", async () => {
		const prompt = renderPrompt(input<number>, {
			message: "Port?",
			default: "4000",
			schema: z.coerce.number().int(),
		});

		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe(4000);
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
	it("dispatches a callable schema through the schema branch", async () => {
		function isString<Value>(value: Value): value is Value & string {
			return typeof value === "string";
		}

		// Build a callable function that also has a `~standard` property.
		const callable = Object.assign(() => undefined, {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate: <Value>(value: Value) => {
					if (isString(value) && value.length > 0) {
						return { value: `[${value}]` };
					}
					return { issues: [{ message: "empty" }] };
				},
			},
		});

		const prompt = renderPrompt(input<string>, { message: "Word?", schema: callable });

		await tick();
		pressKey(prompt, "", { name: "return" });
		await tick();
		expect(prompt.screen()).toContain("empty");

		pressKey(prompt, "a");
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("[a]");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Type-level inference (compile-time only — never executed at runtime)
// ────────────────────────────────────────────────────────────────────────────

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

async function _inputTypeInferenceTests() {
	// Schema overload — resolves to the schema's transformed Output.
	// Strict Equal so a regression to `any`/union cannot slip through.
	const port = await input({
		message: "?",
		schema: z.coerce.number(),
	});
	type _PortIsNumber = Expect<Equal<typeof port, number>>;

	// Function-validator overload — resolves to string. Throw-on-fail contract.
	const name = await input({
		message: "?",
		validate: (v) => {
			if (v.length === 0) throw new Error("required");
		},
	});
	type _NameIsString = Expect<Equal<typeof name, string>>;

	// No validate — resolves to string.
	const raw = await input({ message: "?" });
	type _RawIsString = Expect<Equal<typeof raw, string>>;

	const schemaInWrongSlot = z.string();
	// @ts-expect-error — Standard Schemas belong in `schema`, not `validate`
	void input({ validate: schemaInWrongSlot });
	// @ts-expect-error — schema and validate are exclusive
	void input({ schema: z.string(), validate: () => {} });
}
