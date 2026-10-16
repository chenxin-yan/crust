import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { renderPrompt } from "../testing.ts";
import { input } from "./input.ts";
import { nonTTYIO, tick } from "./test-helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Initial value — empty-string edge case
// ────────────────────────────────────────────────────────────────────────────

// Guards the `options.initial !== undefined` semantics against a regression to
// a truthy check (which would treat "" as absent and drop into interactive mode).
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
	it("renders placeholder when no value entered", async () => {
		const prompt = renderPrompt(input, {
			message: "Name?",
			placeholder: "Enter your name",
		});

		await tick();
		expect(prompt.screen()).toContain("Enter your name");

		prompt.keys("return");
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

		prompt.keys("return");
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

		prompt.keys("return");
		await prompt.answer;
	});

	it("uses default value when submitting empty input", async () => {
		const prompt = renderPrompt(input, {
			message: "Name?",
			default: "DefaultName",
		});

		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("DefaultName");
	});

	it("submits typed value even when default is set", async () => {
		const prompt = renderPrompt(input, {
			message: "Name?",
			default: "DefaultName",
		});

		await tick();
		prompt.type("X");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("X");
	});

	it("renders the submitted success line", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		prompt.type("O");
		await tick();
		prompt.type("K");
		await tick();
		prompt.keys("return");

		await prompt.answer;
		expect(prompt.screen()).toBe("✓ Name? OK");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Keypress handling (editing)
// ────────────────────────────────────────────────────────────────────────────

describe("input — keypress editing", () => {
	it("backspace deletes character before cursor", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		prompt.type("A");
		await tick();
		prompt.type("B");
		await tick();
		prompt.keys("backspace");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("A");
	});

	it("backspace at position 0 does nothing", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		prompt.keys("backspace");
		await tick();
		prompt.type("A");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("A");
	});

	it("delete removes character at cursor", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		prompt.type("A");
		await tick();
		prompt.type("B");
		await tick();
		prompt.type("C");
		await tick();
		// Move cursor left to position before C
		prompt.keys("left");
		await tick();
		prompt.keys("left");
		await tick();
		// Delete the character at cursor (B)
		prompt.keys("delete");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("AC");
	});

	it("left arrow moves cursor left", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		prompt.type("A");
		await tick();
		prompt.type("B");
		await tick();
		// Move left, then type C — inserts before B
		prompt.keys("left");
		await tick();
		prompt.type("C");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("ACB");
	});

	it("right arrow moves cursor right", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		prompt.type("A");
		await tick();
		prompt.type("B");
		await tick();
		// Move left twice, then right once — cursor is between A and B
		prompt.keys("left");
		await tick();
		prompt.keys("left");
		await tick();
		prompt.keys("right");
		await tick();
		prompt.type("C");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("ACB");
	});

	it("home key jumps to start", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		prompt.type("A");
		await tick();
		prompt.type("B");
		await tick();
		prompt.keys("home");
		await tick();
		prompt.type("C");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("CAB");
	});

	it("end key jumps to end", async () => {
		const prompt = renderPrompt(input, { message: "Name?" });

		await tick();
		prompt.type("A");
		await tick();
		prompt.type("B");
		await tick();
		prompt.keys("home");
		await tick();
		prompt.keys("end");
		await tick();
		prompt.type("C");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("ABC");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

describe("input — validation", () => {
	it("shows error message when validation fails", async () => {
		let validateCallCount = 0;
		const prompt = renderPrompt(input, {
			message: "Email?",
			validate: (v) => {
				validateCallCount++;
				if (!v.includes("@")) throw new Error("Must contain @");
			},
		});

		await tick();
		prompt.type("a");
		await tick();
		prompt.type("b");
		await tick();
		// Try to submit invalid value
		prompt.keys("return");
		await tick();

		// Error should be displayed
		expect(prompt.screen()).toContain("Must contain @");

		// Now type valid input and resubmit
		prompt.type("@");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("ab@");
		expect(validateCallCount).toBe(2);
	});

	it("validates default value when used", async () => {
		const prompt = renderPrompt(input, {
			message: "Name?",
			default: "bad",
			validate: (v) => {
				if (v === "bad") throw new Error("Required");
			},
		});

		await tick();
		// Submit without typing — the non-empty default should fail validation
		prompt.keys("return");
		await tick();

		expect(prompt.screen()).toContain("Required");

		// Type something and submit
		prompt.type("X");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("X");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("input — no message", () => {
	it("renders default message before and after submission", async () => {
		const prompt = renderPrompt(input, {});

		await tick();
		expect(prompt.screen()).toContain("Enter a value");
		expect(prompt.screen()).not.toContain("undefined");

		prompt.type("A");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("A");
		expect(prompt.screen()).toContain("Enter a value");
		expect(prompt.screen()).not.toContain("undefined");
		expect(prompt.screen()).toContain("A");
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

	it("resolves to the schema's transformed output (number from coerce)", async () => {
		const prompt = renderPrompt(input<number>, {
			message: "Port?",
			schema: z.coerce.number().int().min(1),
		});

		await tick();
		prompt.type("4");
		await tick();
		prompt.type("2");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(42);
	});

	it("renders the first issue's message and waits for retry on failure", async () => {
		const prompt = renderPrompt(input<string>, {
			message: "Name?",
			schema: z.string().min(3, "Too short"),
		});

		await tick();
		prompt.type("A");
		await tick();
		// Submit too-short value
		prompt.keys("return");
		await tick();

		expect(prompt.screen()).toContain("Too short");

		// Add more characters and retry
		prompt.type("l");
		await tick();
		prompt.type("i");
		await tick();
		prompt.keys("return");

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
		prompt.type("x");
		await tick();
		prompt.keys("return");
		await tick();

		expect(prompt.screen()).toContain("Validation failed");

		// Clear field, type valid value, submit
		prompt.keys("backspace");
		await tick();
		prompt.type("o");
		await tick();
		prompt.type("k");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("ok");
	});

	it("treats `{ issues: [] }` from a non-conformant schema as success", async () => {
		// Spec only marks `issues === undefined` as success, but a malformed
		// schema returning an empty array has no actual issue to surface —
		// reading `issues?.[0]` finds no issue and treats it as success.
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
		prompt.type("o");
		await tick();
		prompt.type("k");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("ok");
		expect(prompt.screen()).not.toContain("Validation failed");
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
});

describe("input — schema + interactive default", () => {
	it("runs schema against the default value when user submits empty", async () => {
		const prompt = renderPrompt(input<number>, {
			message: "Port?",
			default: "4000",
			schema: z.coerce.number().int(),
		});

		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(4000);
	});
});
