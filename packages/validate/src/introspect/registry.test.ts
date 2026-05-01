import { describe, expect, it } from "bun:test";
import * as Schema from "effect/Schema";
import { z } from "zod";
import type { StandardSchema } from "../types.ts";
import { inferOptions } from "./registry.ts";

describe("inferOptions — vendor dispatch", () => {
	// ─── Zod ───────────────────────────────────────────────────────────────
	describe('vendor = "zod"', () => {
		it("infers primitive type for z.string()", () => {
			const result = inferOptions(z.string(), "arg", 'arg "x"');
			expect(result.type).toBe("string");
			expect(result.multiple).toBe(false);
			expect(result.optional).toBe(false);
		});

		it("infers primitive type for z.number()", () => {
			const result = inferOptions(z.number(), "arg", 'arg "x"');
			expect(result.type).toBe("number");
			expect(result.optional).toBe(false);
		});

		it("infers primitive type for z.boolean()", () => {
			const result = inferOptions(z.boolean(), "flag", "flag");
			expect(result.type).toBe("boolean");
			expect(result.optional).toBe(false);
		});

		it("detects optionality from .optional()", () => {
			const result = inferOptions(z.string().optional(), "arg", 'arg "x"');
			expect(result.type).toBe("string");
			expect(result.optional).toBe(true);
		});

		it("detects optionality from .default()", () => {
			const result = inferOptions(
				z.string().default("hello"),
				"arg",
				'arg "x"',
			);
			expect(result.type).toBe("string");
			expect(result.optional).toBe(true);
		});

		it("detects array shape via z.array()", () => {
			const result = inferOptions(z.array(z.string()), "arg", 'arg "files"');
			expect(result.type).toBe("string");
			expect(result.multiple).toBe(true);
		});

		it("walks pipe/transform to the input side", () => {
			const result = inferOptions(
				z.string().transform((s) => s.toUpperCase()),
				"arg",
				'arg "x"',
			);
			expect(result.type).toBe("string");
		});

		it("reads description from .describe()", () => {
			const result = inferOptions(
				z.number().describe("Port to listen on"),
				"arg",
				'arg "port"',
			);
			expect(result.description).toBe("Port to listen on");
		});

		it("walks wrappers to find description", () => {
			const result = inferOptions(
				z.number().describe("Port to listen on").optional(),
				"arg",
				'arg "port"',
			);
			expect(result.description).toBe("Port to listen on");
		});

		it("infers from enum", () => {
			const result = inferOptions(z.enum(["json", "text"]), "flag", "flag");
			expect(result.type).toBe("string");
		});

		it("infers from literal", () => {
			expect(inferOptions(z.literal("v1"), "flag", "flag").type).toBe("string");
			expect(inferOptions(z.literal(42), "flag", "flag").type).toBe("number");
			expect(inferOptions(z.literal(true), "flag", "flag").type).toBe(
				"boolean",
			);
		});
	});

	// ─── Effect ────────────────────────────────────────────────────────────
	describe('vendor = "effect"', () => {
		it("infers primitive type for Schema.Number wrapped via standardSchemaV1", () => {
			const wrapped = Schema.standardSchemaV1(Schema.Number);
			const result = inferOptions(wrapped, "arg", 'arg "x"');
			expect(result.type).toBe("number");
			expect(result.multiple).toBe(false);
			expect(result.optional).toBe(false);
		});

		it("infers primitive type for Schema.String", () => {
			const wrapped = Schema.standardSchemaV1(Schema.String);
			const result = inferOptions(wrapped, "arg", 'arg "x"');
			expect(result.type).toBe("string");
			expect(result.optional).toBe(false);
		});

		it("infers primitive type for Schema.Boolean", () => {
			const wrapped = Schema.standardSchemaV1(Schema.Boolean);
			const result = inferOptions(wrapped, "flag", "flag");
			expect(result.type).toBe("boolean");
			expect(result.optional).toBe(false);
		});

		it("detects optionality from Schema.UndefinedOr", () => {
			const wrapped = Schema.standardSchemaV1(
				Schema.UndefinedOr(Schema.String),
			);
			const result = inferOptions(wrapped, "arg", 'arg "x"');
			expect(result.type).toBe("string");
			expect(result.optional).toBe(true);
		});

		it("detects array shape via Schema.Array", () => {
			const wrapped = Schema.standardSchemaV1(Schema.Array(Schema.String));
			const result = inferOptions(wrapped, "arg", 'arg "files"');
			expect(result.type).toBe("string");
			expect(result.multiple).toBe(true);
		});

		it("reads description annotation", () => {
			const annotated = Schema.Number.annotations({
				description: "Port to listen on",
			});
			const wrapped = Schema.standardSchemaV1(annotated);
			const result = inferOptions(wrapped, "arg", 'arg "port"');
			expect(result.description).toBe("Port to listen on");
		});

		it("walks transformations to find description on inner schema", () => {
			const annotated = Schema.String.annotations({ description: "Inner" });
			const wrapped = Schema.standardSchemaV1(Schema.UndefinedOr(annotated));
			const result = inferOptions(wrapped, "arg", 'arg "x"');
			expect(result.description).toBe("Inner");
		});

		it("returns {} when wrapper does not expose .ast", () => {
			// Synthetic Standard Schema that mimics the effect vendor without an AST
			const fake: StandardSchema = {
				"~standard": {
					version: 1,
					vendor: "effect",
					validate: () => ({ value: undefined }),
				},
			};
			const result = inferOptions(fake, "arg", 'arg "x"');
			expect(result).toEqual({});
		});

		it("terminates on factory-style Suspend that allocates a fresh AST per call", () => {
			// Mutually recursive schemas can return a freshly-allocated AST
			// from the `Suspend.f()` thunk, so identity-based cycle detection
			// never fires. The depth cap must bound the walk.
			const makeSelfReferentialSuspend = () => {
				const ast = {
					_tag: "Suspend",
					annotations: {},
					// Each call returns a new node — not the same identity —
					// pointing back at another fresh Suspend, ad infinitum.
					f: () => makeSelfReferentialSuspend(),
				};
				return ast;
			};
			const fake: StandardSchema & { ast: unknown } = {
				"~standard": {
					version: 1,
					vendor: "effect",
					validate: () => ({ value: undefined }),
				},
				ast: makeSelfReferentialSuspend(),
			};

			const start = Date.now();
			const result = inferOptions(fake, "arg", 'arg "x"');
			const elapsed = Date.now() - start;

			// Should terminate in well under a second; the depth cap (1024)
			// keeps it bounded even though identity-based cycle detection
			// never fires. No `type` is inferable from the synthetic graph.
			expect(elapsed).toBeLessThan(500);
			expect(result.type).toBeUndefined();
		});
	});

	// ─── Unknown vendor ────────────────────────────────────────────────────
	describe("unknown vendor", () => {
		it('returns {} for vendor = "valibot"', () => {
			const fake: StandardSchema = {
				"~standard": {
					version: 1,
					vendor: "valibot",
					validate: (value) => ({ value }),
				},
			};
			const result = inferOptions(fake, "arg", 'arg "x"');
			expect(result).toEqual({});
		});

		it('returns {} for vendor = "arktype"', () => {
			const fake: StandardSchema = {
				"~standard": {
					version: 1,
					vendor: "arktype",
					validate: (value) => ({ value }),
				},
			};
			const result = inferOptions(fake, "arg", 'arg "x"');
			expect(result).toEqual({});
		});

		it('returns {} for vendor = "sury"', () => {
			const fake: StandardSchema = {
				"~standard": {
					version: 1,
					vendor: "sury",
					validate: (value) => ({ value }),
				},
			};
			const result = inferOptions(fake, "flag", "flag");
			expect(result).toEqual({});
		});
	});
});
