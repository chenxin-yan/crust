import { describe, expect, it } from "bun:test";

import type { StandardSchema } from "@crustjs/utils/schema";
import { z } from "zod";

import { CrustStoreError } from "./errors.ts";
import { field } from "./field.ts";

describe("field() — raw schema-backed runtime shape", () => {
	it("does not infer type, array, description, or default from schemas", () => {
		const def = field(z.string().describe("Theme").default("dark"));
		expect(def.type).toBeUndefined();
		expect(def.description).toBeUndefined();
		expect("default" in def).toBe(false);
		expect("array" in def).toBe(false);
		expect(typeof def.validate).toBe("function");
	});

	it("uses explicit Crust metadata when supplied", () => {
		const def = field(z.string(), {
			type: "string",
			description: "Theme",
			default: "light",
		});
		expect(def.type).toBe("string");
		expect(def.description).toBe("Theme");
		expect((def as { default?: unknown }).default).toBe("light");
	});

	it("uses explicit array metadata when supplied", () => {
		const def = field(z.array(z.string()), { array: true });
		expect((def as { array?: unknown }).array).toBe(true);
	});

	it("accepts any Standard Schema vendor without explicit type", () => {
		const opaque: StandardSchema<unknown, unknown> = {
			"~standard": {
				version: 1,
				vendor: "valibot-fake",
				validate: (v) => ({ value: v }),
			},
		};
		expect(() => field(opaque)).not.toThrow();
	});

	it("throws CrustStoreError DEFINITION for non-Standard-Schema input", () => {
		// oxlint-disable-next-line typescript/no-explicit-any -- testing runtime guard
		expect(() => field({} as any)).toThrow(CrustStoreError);
	});
});

describe("field() — validate adapter", () => {
	it("returns a validate function that resolves to { value } on valid input", async () => {
		const def = field(z.string());
		await expect(def.validate("hello")).resolves.toEqual({ value: "hello" });
	});

	it("returns a validate function that resolves to the transformed value", async () => {
		const def = field(z.string().transform((s) => s.trim()));
		await expect(def.validate("  hi  ")).resolves.toEqual({ value: "hi" });
	});

	it("validates missing values as undefined so schema defaults work", async () => {
		const def = field(z.string().default("x"));
		await expect(def.validate(undefined)).resolves.toEqual({ value: "x" });
	});

	it("validates missing values as undefined so optional schemas work", async () => {
		const def = field(z.string().optional());
		await expect(def.validate(undefined)).resolves.toEqual({
			value: undefined,
		});
	});

	it("rejects missing values when the schema rejects undefined", async () => {
		const def = field(z.string());
		await expect(def.validate(undefined)).rejects.toThrow(Error);
	});

	it("returns a validate function that rejects on invalid input", async () => {
		const def = field(z.string());
		await expect(def.validate(123)).rejects.toThrow(Error);
	});

	it("validate error messages use schema's normalized issue messages", async () => {
		const def = field(z.string().min(5, "Too short"));
		try {
			await def.validate("ab");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(Error);
			expect((err as Error).message).toContain("Too short");
		}
	});
});

describe("field() — type-level integration with FieldDef", () => {
	it("returns a value structurally compatible with store FieldDef.validate", async () => {
		const def = field(z.string());
		await expect(def.validate("ok")).resolves.toEqual({ value: "ok" });
	});
});
