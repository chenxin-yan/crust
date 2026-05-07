import { describe, expect, it } from "bun:test";
import { CrustError } from "@crustjs/core";
import * as Schema from "effect/Schema";
import { z } from "zod";
import { field } from "./store.ts";
import type { StandardSchema } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// field(schema, opts?) — runtime FieldDef factory
// ────────────────────────────────────────────────────────────────────────────

describe("field() — runtime shape", () => {
	it("infers type=string for z.string()", () => {
		const def = field(z.string());
		expect(def.type).toBe("string");
		expect("array" in def && (def as { array?: unknown }).array).toBe(false);
		expect(typeof def.validate).toBe("function");
	});

	it("infers type=number for z.number()", () => {
		const def = field(z.number());
		expect(def.type).toBe("number");
	});

	it("infers type=boolean for z.boolean()", () => {
		const def = field(z.boolean());
		expect(def.type).toBe("boolean");
	});

	it("infers array=true for z.array(z.string())", () => {
		const def = field(z.array(z.string()).default([]));
		expect(def.type).toBe("string");
		expect((def as { array?: unknown }).array).toBe(true);
		expect((def as { default?: unknown }).default).toEqual([]);
	});

	it("opts.default overrides schema default", () => {
		const def = field(z.string().default("x"), { default: "y" });
		expect((def as { default?: unknown }).default).toBe("y");
	});

	it("opts.description overrides inferred description", () => {
		const def = field(z.string().describe("from schema"), {
			description: "from opts",
		});
		expect(def.description).toBe("from opts");
	});

	it("opts.type overrides inferred type", () => {
		const def = field(z.string(), { type: "number" });
		expect((def as { type: string }).type).toBe("number");
	});

	it("inferred description is preserved when opts.description is omitted", () => {
		const def = field(z.string().describe("Theme"));
		expect(def.description).toBe("Theme");
	});

	it("throws CrustError DEFINITION when type cannot be inferred and opts.type is missing", () => {
		// Custom Standard Schema with unknown vendor — no type inference.
		const opaque: StandardSchema<unknown, unknown> = {
			"~standard": {
				version: 1,
				vendor: "valibot-fake",
				validate: (v) => ({ value: v }),
			},
		};
		expect(() => field(opaque)).toThrow(CrustError);
	});

	it("accepts explicit type for unknown-vendor schemas", () => {
		const opaque: StandardSchema<unknown, unknown> = {
			"~standard": {
				version: 1,
				vendor: "valibot-fake",
				validate: (v) => ({ value: v }),
			},
		};
		const def = field(opaque, { type: "string" });
		expect(def.type).toBe("string");
	});

	it("throws DEFINITION error for non-Standard-Schema input", () => {
		// biome-ignore lint/suspicious/noExplicitAny: testing runtime guard
		expect(() => field({} as any)).toThrow(CrustError);
	});
});

describe("field() — validate adapter", () => {
	it("returns a validate function that resolves on valid input", async () => {
		const def = field(z.string());
		await expect(def.validate("hello")).resolves.toBeUndefined();
	});

	it("returns a validate function that rejects on invalid input", async () => {
		const def = field(z.string());
		await expect(def.validate(123)).rejects.toThrow(Error);
	});

	it("validate error messages use schema's normalized issue messages", async () => {
		const def = field(z.string().min(5, "Too short"));
		try {
			await def.validate("ab");
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(Error);
			expect((err as Error).message).toContain("Too short");
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Default extraction — vendor-aware + sync fallback behavior
// ────────────────────────────────────────────────────────────────────────────

describe("default extraction — Zod", () => {
	it("z.string().default('x') extracts 'x'", () => {
		const def = field(z.string().default("x"));
		expect((def as { default?: unknown }).default).toBe("x");
	});

	it("z.boolean().default(false) extracts false (falsy default)", () => {
		const def = field(z.boolean().default(false));
		expect((def as { default?: unknown }).default).toBe(false);
	});

	it("z.number().default(0) extracts 0 (falsy default)", () => {
		const def = field(z.number().default(0));
		expect((def as { default?: unknown }).default).toBe(0);
	});

	it("z.string().default('') extracts '' (falsy default)", () => {
		const def = field(z.string().default(""));
		expect((def as { default?: unknown }).default).toBe("");
	});

	it("z.string() (no default) omits the default key", () => {
		const def = field(z.string());
		expect("default" in def).toBe(false);
	});

	it("z.array(z.string()).default([]) extracts []", () => {
		const def = field(z.array(z.string()).default([]));
		expect((def as { default?: unknown }).default).toEqual([]);
	});

	it("nested .default() under .optional() is recovered", () => {
		// z.string().default("x").optional() — the default still injects.
		const def = field(z.string().default("x").optional());
		expect((def as { default?: unknown }).default).toBe("x");
	});

	it("async-only schema falls back to { ok: false } silently — no default key", () => {
		// Schema whose `~standard.validate` returns a Promise — sync fallback
		// must abort. We construct one that mimics this behavior; the schema
		// has no .default(), so the vendor-aware path also returns false.
		const asyncOnly: StandardSchema<unknown, string> = {
			"~standard": {
				version: 1,
				vendor: "valibot-fake",
				validate: async (v) => ({ value: String(v) }),
			},
		};
		const def = field(asyncOnly, { type: "string" });
		expect("default" in def).toBe(false);
	});
});

describe("default extraction — Effect", () => {
	it("Schema.String.annotations({ default: 'x' }) extracts 'x' (vendor-aware AST annotation read)", () => {
		const schema = Schema.standardSchemaV1(
			Schema.String.annotations({ default: "x" }),
		);
		const def = field(schema);
		// Vendor-aware AST read finds the default annotation directly.
		expect((def as { default?: unknown }).default).toBe("x");
	});

	it("Schema.String (no default) omits the default key", () => {
		const schema = Schema.standardSchemaV1(Schema.String);
		const def = field(schema);
		expect("default" in def).toBe(false);
	});

	it("thunk default that throws — no default key (parity with validate(undefined) catch)", () => {
		// Mirrors a real-world pattern: a default factory that reads env/state
		// at definition time and throws when it's missing. The throw must be
		// recovered the same way the vendor-neutral `validate(undefined)`
		// fallback recovers throws — silently — so `field()` either falls
		// through to opts or omits the default key.
		// `Schema.String.annotations({ default })` types `default` as `string`,
		// but Effect itself stores the annotation untyped on the AST and
		// `optionalWith({ default: () => x })` writes a thunk through that
		// same channel — the failure mode this test covers. Cast to bypass the
		// per-schema-narrowed surface and exercise the runtime path.
		const annotated = Schema.String.annotations({
			default: (() => {
				throw new Error("factory boom");
			}) as unknown as string,
		});
		const schema = Schema.standardSchemaV1(annotated);
		expect(() => field(schema)).not.toThrow();
		const def = field(schema);
		expect("default" in def).toBe(false);
	});
});

describe("default extraction — vendor-neutral fallback", () => {
	it("custom schema returning value for undefined input — extracts that value", () => {
		// Mimics Valibot's `v.optional(v.string(), 'x')` behavior: validate(undefined)
		// returns the default value synchronously.
		const schemaWithDefault: StandardSchema<string | undefined, string> = {
			"~standard": {
				version: 1,
				vendor: "valibot-fake",
				validate: (v) => ({ value: (v === undefined ? "x" : v) as string }),
			},
		};
		const def = field(schemaWithDefault, { type: "string" });
		expect((def as { default?: unknown }).default).toBe("x");
	});

	it("custom schema rejecting undefined input — no default", () => {
		const schemaRejecting: StandardSchema<string, string> = {
			"~standard": {
				version: 1,
				vendor: "valibot-fake",
				validate: (v) => {
					if (v === undefined) {
						return { issues: [{ message: "Required" }] };
					}
					return { value: v as string };
				},
			},
		};
		const def = field(schemaRejecting, { type: "string" });
		expect("default" in def).toBe(false);
	});

	it("schema with async validate(undefined) — no default (sync-only)", () => {
		const asyncOnly: StandardSchema<unknown, string> = {
			"~standard": {
				version: 1,
				vendor: "unknown",
				validate: async (v) => ({ value: String(v) }),
			},
		};
		const def = field(asyncOnly, { type: "string" });
		expect("default" in def).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Type-level smoke tests via assignment (compile-time only)
// ────────────────────────────────────────────────────────────────────────────

describe("field() — type-level integration with FieldDef", () => {
	it("returns a value structurally compatible with store FieldDef.validate", async () => {
		const def = field(z.string());
		// Structural check: validate signature aligns with FieldDef.validate
		const validate: (value: unknown) => void | Promise<void> = def.validate;
		await validate("hello");
	});
});
