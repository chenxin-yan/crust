/**
 * @module-tag windows
 * @module-tag macos
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
	chmod,
	lstat,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { CrustStoreError } from "./errors.ts";
import { createStore } from "./store.ts";
import type { FieldsDef } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(async () => {
	tempDir = join(tmpdir(), `crust-store-test-${randomUUID()}`);
	await mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

const BASIC_FIELDS = {
	theme: { type: "string", default: "light" },
	verbose: { type: "boolean", default: false },
} as const satisfies FieldsDef;

const VALIDATED_FIELDS = {
	port: {
		type: "number",
		default: 3000,
		validate: (v: number) => {
			if (v < 1 || v > 65535) throw new Error("port must be 1-65535");
		},
	},
	host: { type: "string", default: "localhost" },
} as const satisfies FieldsDef;

// ────────────────────────────────────────────────────────────────────────────
// createStore — factory
// ────────────────────────────────────────────────────────────────────────────

describe("createStore", () => {
	// POSIX-only: Windows ignores Unix permission bits (it uses ACLs).
	it.skipIf(process.platform === "win32")(
		"should persist a private store as owner-only",
		async () => {
			const store = createStore({
				dirPath: tempDir,
				name: "auth",
				fields: BASIC_FIELDS,
				access: "private",
			});

			const previous = process.umask(0o000);
			try {
				await store.write({ theme: "dark", verbose: true });
				await store.patch({ theme: "light" });
			} finally {
				process.umask(previous);
			}

			const { mode } = await stat(join(tempDir, "auth.json"));
			expect(mode & 0o777).toBe(0o600);
		},
	);
});

// ────────────────────────────────────────────────────────────────────────────
// read
// ────────────────────────────────────────────────────────────────────────────

describe("store.read", () => {
	it.each([
		["string", JSON.stringify("invalid root")],
		["number", "42"],
		["array", "[]"],
		["null", "null"],
	])("should throw PARSE error when persisted JSON root is a %s", async (_kind, content) => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, content);

		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: BASIC_FIELDS,
		});

		await expect(store.read()).rejects.toMatchObject({ name: "CrustStoreError", code: "PARSE" });
	});

	it("should run field validators on read", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ port: 0, host: "localhost" }));

		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: VALIDATED_FIELDS,
		});

		await expect(store.read()).rejects.toMatchObject({
			name: "CrustStoreError",
			code: "VALIDATION",
			details: { operation: "read", issues: [{ path: "port" }] },
		});
	});

	it("should skip validation for undefined optional fields", async () => {
		const fields = {
			token: {
				type: "string",
				validate: () => {
					throw new Error("should not be called");
				},
			},
		} as const satisfies FieldsDef;

		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields,
		});

		// Should not throw — token is undefined, validation is skipped
		const result = await store.read();
		expect(result.token).toBeUndefined();
	});

	it("should coerce persisted number, boolean and array element strings on read", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(
			filePath,
			JSON.stringify({ retries: "42", enabled: "true", ports: ["3000", "8080"] }),
		);

		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: {
				retries: { type: "number", default: 0 },
				enabled: { type: "boolean", default: false },
				ports: { type: "number", array: true, default: [] },
			},
		});

		expect(await store.read()).toEqual({ retries: 42, enabled: true, ports: [3000, 8080] });
	});

	it.each(["abc", "", "  "])("should reject persisted %j for a number field", async (port) => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ port }));

		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: { port: { type: "number" } },
		});

		await expect(store.read()).rejects.toMatchObject({
			code: "VALIDATION",
			details: {
				operation: "read",
				issues: [{ path: "port" }],
			},
		});
	});

	it.each([
		["a non-array value", "not-an-array"],
		["an element with the wrong type", ["valid", 1]],
	])("should reject %s for an array field", async (_case, tags) => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ tags }));

		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: { tags: { type: "string", array: true } },
		});

		await expect(store.read()).rejects.toMatchObject({
			code: "VALIDATION",
			details: {
				operation: "read",
				issues: [{ message: "Expected string[]", path: "tags" }],
			},
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// write
// ────────────────────────────────────────────────────────────────────────────

describe("store.write", () => {
	it("should run field validators on write", async () => {
		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: VALIDATED_FIELDS,
		});

		await expect(store.write({ port: 99999, host: "localhost" })).rejects.toMatchObject({
			name: "CrustStoreError",
			code: "VALIDATION",
			details: {
				operation: "write",
				issues: [{ path: "port", message: "port must be 1-65535" }],
			},
		});
		expect(existsSync(join(tempDir, "config.json"))).toBe(false);
	});

	it("should coerce values before running field validators on write", async () => {
		const fields = {
			port: {
				type: "number",
				default: 3000,
				validate: (v: number) => {
					expect(v).toBe(8080);
					if (v < 1 || v > 65535) throw new Error("invalid port");
				},
			},
		} as const satisfies FieldsDef;

		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields,
		});

		const malformedConfig: { port: number } = JSON.parse('{"port":"8080"}');
		await store.write(malformedConfig);

		const raw = await readFile(join(tempDir, "config.json"), "utf-8");
		expect(JSON.parse(raw)).toEqual({ port: 8080 });
	});
});

// ────────────────────────────────────────────────────────────────────────────
// update
// ────────────────────────────────────────────────────────────────────────────

describe("store.update", () => {
	it("resolves schema coercion and nested defaults before the updater", async () => {
		const filePath = join(tempDir, "config.json");
		const raw = JSON.stringify({ count: "42", payload: {} });
		await writeFile(filePath, raw);
		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: {
				count: { schema: z.coerce.number() },
				payload: { schema: z.object({ name: z.string().default("anonymous") }) },
			},
		});
		const expected = { count: 42, payload: { name: "anonymous" } };
		expect(await store.read()).toEqual(expected);
		expect(await readFile(filePath, "utf8")).toBe(raw);
		const updated = await store.update((current) => {
			expect(current).toEqual(expected);
			return current;
		});
		expect(updated).toEqual(await store.read());
	});

	it("never calls an updater with missing required or invalid persisted state", async () => {
		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: { token: { schema: z.string() }, count: { type: "number", default: 0 } },
		});
		let calls = 0;
		const update = () =>
			store.update((current) => {
				calls++;
				return { ...current, token: "repaired", count: 1 };
			});
		await expect(update()).rejects.toMatchObject({ code: "VALIDATION" });
		expect(existsSync(join(tempDir, "config.json"))).toBe(false);
		const raw = JSON.stringify({ token: "ok", count: "invalid" });
		await writeFile(join(tempDir, "config.json"), raw);
		await expect(update()).rejects.toMatchObject({ code: "VALIDATION" });
		expect(calls).toBe(0);
		expect(await readFile(join(tempDir, "config.json"), "utf8")).toBe(raw);
		// Patch can repair state without exposing it as a typed callback input.
		expect(await store.patch({ count: 1 })).toEqual(await store.read());
	});
});

// ────────────────────────────────────────────────────────────────────────────
// patch
// ────────────────────────────────────────────────────────────────────────────

describe("store.patch", () => {
	it("rejects undefined defaulted core fields but preserves genuinely optional fields", async () => {
		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: {
				enabled: { type: "boolean", default: true },
				token: { type: "string" },
				optional: { schema: z.string().optional() },
			},
		});
		await expect(store.patch({ enabled: undefined })).rejects.toMatchObject({
			code: "VALIDATION",
			details: { operation: "patch", issues: [{ path: "enabled" }] },
		});
		const invalid = Object.assign(
			{ enabled: true, token: undefined, optional: undefined },
			{ enabled: undefined },
		);
		await expect(store.write(invalid)).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(store.update(() => invalid)).rejects.toMatchObject({ code: "VALIDATION" });
		expect(existsSync(join(tempDir, "config.json"))).toBe(false);
		const patched = await store.patch({ token: undefined, optional: undefined });
		expect(patched).toEqual(await store.read());
		expect(patched.enabled).toBe(true);
		expect(patched.token).toBeUndefined();

		const required = createStore({
			dirPath: tempDir,
			name: "required",
			fields: { token: { schema: z.string() } },
		});
		await expect(required.patch({ token: undefined })).rejects.toMatchObject({
			code: "VALIDATION",
		});
	});

	it("should preserve schema defaults when patching another field", async () => {
		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: {
				theme: { schema: z.enum(["light", "dark"]).default("light") },
				verbose: { type: "boolean", default: false },
			},
		});

		await expect(store.patch({ verbose: true })).resolves.toEqual({
			theme: "light",
			verbose: true,
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Full lifecycle integration
// ────────────────────────────────────────────────────────────────────────────

describe("store lifecycle", () => {
	it("should support full read → write → update → patch → reset cycle", async () => {
		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: BASIC_FIELDS,
		});

		expect(await store.read()).toEqual({ theme: "light", verbose: false });

		await store.write({ theme: "dark", verbose: true });
		expect(await store.read()).toEqual({ theme: "dark", verbose: true });

		await store.update((c) => ({ ...c, verbose: false }));
		expect(await store.read()).toEqual({ theme: "dark", verbose: false });

		await store.patch({ theme: "solarized" });
		expect(await store.read()).toEqual({ theme: "solarized", verbose: false });

		await store.reset();
		expect(await store.read()).toEqual({ theme: "light", verbose: false });
		expect(existsSync(join(tempDir, "config.json"))).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Field validation
// ────────────────────────────────────────────────────────────────────────────

describe("field validation", () => {
	it("should collect multiple validation issues", async () => {
		const fields = {
			port: {
				type: "number",
				default: 3000,
				validate: (v: number) => {
					if (v < 1) throw new Error("port too low");
				},
			},
			host: {
				type: "string",
				default: "localhost",
				validate: (v: string) => {
					if (v === "") throw new Error("host required");
				},
			},
		} as const satisfies FieldsDef;

		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields,
		});

		await expect(store.write({ port: 0, host: "" })).rejects.toMatchObject({
			name: "CrustStoreError",
			code: "VALIDATION",
			details: { issues: [{ path: "port" }, { path: "host" }] },
		});
	});

	it("should reject non-finite mutation values before persistence", async () => {
		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: { amount: { type: "number", default: 0 } },
		});

		await expect(store.write({ amount: Number.NaN })).rejects.toMatchObject({
			code: "VALIDATION",
			details: { operation: "write" },
		});
		await expect(store.update(() => ({ amount: Number.POSITIVE_INFINITY }))).rejects.toMatchObject({
			code: "VALIDATION",
			details: { operation: "update" },
		});
		const malformedPatch: { amount?: number } = JSON.parse('{"amount":"Infinity"}');
		await expect(store.patch(malformedPatch)).rejects.toMatchObject({
			code: "VALIDATION",
			details: { operation: "patch" },
		});
		expect(existsSync(join(tempDir, "config.json"))).toBe(false);
	});
});

// ─────────────────────────────────────────────────────────────────────────
// Schema-driven transform persistence + read-stability guard
// ─────────────────────────────────────────────────────────────────────────
//
// Closes the command/store asymmetry: schema transforms (e.g.
// `z.string().transform(s => s.trim())`) MUST persist on write/update/
// patch operations. Reads resolve schema output without writing to disk.
// A write-time read-stability guard rejects cross-type transforms
// whose output would fail the schema's own re-validation on the next
// read.

describe("schema transform persistence", () => {
	it("materializes transformed schema defaults from missing persisted values", async () => {
		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: { count: { schema: z.string().default("123").transform(Number) } },
		});

		await expect(store.read()).resolves.toEqual({ count: 123 });
	});

	it("rejects schema definitions mixed with defaults or validators", () => {
		for (const field of [
			{ schema: z.string(), default: "x" },
			{ schema: z.string(), validate: () => {} },
		]) {
			const malformedFields: FieldsDef = {};
			Object.assign(malformedFields, { name: field });
			expect(() =>
				createStore({
					dirPath: tempDir,
					name: "config",
					fields: malformedFields,
				}),
			).toThrow(expect.objectContaining({ name: "CrustStoreError", code: "DEFINITION" }));
		}
	});

	it("persists Zod transform output on write (trim example)", async () => {
		const fields = {
			name: { schema: z.string().transform((s) => s.trim()) },
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, name: "config", fields });

		const persisted = await store.write({ name: "  hi  " });

		expect(persisted).toEqual({ name: "hi" });
		expect(persisted).toEqual(await store.read());
		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual(persisted);
	});

	// Schema output is resolved in memory, never written by read().
	it("read transforms without changing the pre-seeded file", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ name: "  hi  " }));

		const fields = {
			name: { schema: z.string().transform((s) => s.trim()) },
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, name: "config", fields });

		const result = await store.read();
		expect(result.name).toBe("hi");

		const rawAfter = await readFile(filePath, "utf-8");
		expect(JSON.parse(rawAfter)).toEqual({ name: "  hi  " });
	});

	// Cross-type transform (string → number) succeeds the first
	// validation but its output fails the schema on re-validation — must
	// surface as `read-unstable transform` at write time and never touch
	// disk.
	it("rejects read-unstable cross-type transform at write time", async () => {
		const fields = {
			x: { schema: z.string().transform((s) => s.length) },
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, name: "config", fields });

		const malformedConfig: { x: number } = JSON.parse('{"x":"hello"}');
		await expect(store.write(malformedConfig)).rejects.toMatchObject({
			name: "CrustStoreError",
			code: "VALIDATION",
			details: {
				operation: "write",
				issues: [{ path: "x", message: expect.stringContaining("read-unstable transform") }],
			},
		});

		// Nothing should have been persisted.
		const filePath = join(tempDir, "config.json");
		expect(existsSync(filePath)).toBe(false);
	});

	// Regression: an array schema whose elements transform (e.g.
	// `z.array(z.string().transform(s => s.trim()))`) must still persist
	// the transformed array — the structural compare must accept the
	// recheck output as stable when contents match by value.
	it("persists Zod array-of-transforms output on write", async () => {
		const fields = {
			tags: { schema: z.array(z.string().transform((s) => s.trim())) },
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, name: "config", fields });

		await store.write({ tags: ["  a  ", "b "] });

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ tags: ["a", "b"] });
	});
});

describe("JSON serialization stability", () => {
	it("rejects schema values that JSON serialization would corrupt", async () => {
		// z.custom accepts NaN, which the built-in number check never sees.
		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: { amount: { schema: z.custom<number>(() => true) } },
		});

		await expect(store.write({ amount: Number.NaN })).rejects.toMatchObject({
			code: "VALIDATION",
			details: { operation: "write", issues: [{ path: "amount" }] },
		});
		expect(existsSync(join(tempDir, "config.json"))).toBe(false);
	});

	it("normalizes cyclic serialization failures to field-scoped VALIDATION errors", async () => {
		interface Recursive {
			self: Recursive;
		}
		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: { payload: { schema: z.custom<Recursive>(() => true).optional() } },
		});
		const cyclic: Recursive = JSON.parse("{}");
		cyclic.self = cyclic;
		for (const mutate of [
			() => store.write({ payload: cyclic }),
			() => store.patch({ payload: cyclic }),
			() => store.update(() => ({ payload: cyclic })),
		]) {
			const result = mutate();
			await expect(result).rejects.toBeInstanceOf(CrustStoreError);
			await expect(result).rejects.toMatchObject({
				code: "VALIDATION",
				details: { issues: [{ path: "payload" }] },
			});
		}
		expect(existsSync(join(tempDir, "config.json"))).toBe(false);
	});
});

describe("core validator transform type enforcement", () => {
	it("rejects core transforms that leave the declared type", async () => {
		const store = createStore({
			dirPath: tempDir,
			name: "config",
			// JSON.parse hides the wrong-typed output — a JS caller can return any JSON value.
			fields: { name: { type: "string", validate: () => ({ value: JSON.parse("1") }) } },
		});

		await expect(store.write({ name: "hi" })).rejects.toMatchObject({
			code: "VALIDATION",
			details: {
				operation: "write",
				issues: [{ message: "Expected string", path: "name" }],
			},
		});
		expect(existsSync(join(tempDir, "config.json"))).toBe(false);
	});

	it("keeps core callback transforms mutation-only", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ name: "  hi  " }));
		const store = createStore({
			dirPath: tempDir,
			name: "config",
			fields: { name: { type: "string", validate: (value) => ({ value: value.trim() }) } },
		});
		expect(await store.read()).toEqual({ name: "  hi  " });
		const patched = await store.patch({});
		expect(patched).toEqual({ name: "hi" });
		expect(patched).toEqual(await store.read());
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Own-property document semantics
// ────────────────────────────────────────────────────────────────────────────

describe("Object.prototype key names", () => {
	const PROTO_KEYS_JSON = '{"constructor":"kept","toString":"t","__proto__":{"a":1}}';

	it("patch preserves unknown prototype-named keys on disk by default", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, PROTO_KEYS_JSON);
		const store = createStore({ dirPath: tempDir, name: "config", fields: BASIC_FIELDS });

		const patched = await store.patch({ theme: "dark" });

		expect(Object.getPrototypeOf(patched)).toBe(Object.prototype);
		expect(Object.entries(patched)).toEqual([
			["theme", "dark"],
			["verbose", false],
		]);
		expect(JSON.parse(await readFile(filePath, "utf-8"))).toEqual(
			JSON.parse(
				'{"constructor":"kept","toString":"t","__proto__":{"a":1},"theme":"dark","verbose":false}',
			),
		);
	});

	for (const pruneUnknown of [true, false]) {
		it(`reads, validates, and patches declared prototype-named fields (pruneUnknown: ${pruneUnknown})`, async () => {
			const filePath = join(tempDir, "config.json");
			const store = createStore({
				dirPath: tempDir,
				name: "config",
				pruneUnknown,
				fields: {
					constructor: { type: "string", default: "c" },
					toString: { type: "number", default: 1 },
					["__proto__"]: { type: "boolean", default: false },
				},
			});

			const initial = await store.read();
			expect(Object.getPrototypeOf(initial)).toBe(Object.prototype);
			expect(Object.entries(initial)).toEqual([
				["constructor", "c"],
				["toString", 1],
				["__proto__", false],
			]);

			// Persisted strings are coerced by declared type, including the `__proto__` field.
			// TypeScript sees inherited `toString` on object literals, so the patch names both.
			await writeFile(filePath, '{"__proto__":"true"}');
			const patched = await store.patch({ constructor: "x", toString: 2 });
			expect(Object.entries(patched)).toEqual([
				["constructor", "x"],
				["toString", 2],
				["__proto__", true],
			]);
			expect(JSON.parse(await readFile(filePath, "utf-8"))).toEqual(
				JSON.parse('{"constructor":"x","toString":2,"__proto__":true}'),
			);
			expect(Object.entries(await store.read())).toEqual(Object.entries(patched));
		});
	}

	for (const name of ["constructor", "toString", "__proto__"]) {
		for (const [kind, def] of [
			["core", { type: "string" }],
			["schema", { schema: z.string().optional() }],
		] as const) {
			for (const pruneUnknown of [true, false]) {
				it(`materializes missing optional ${kind} field "${name}" as own undefined (pruneUnknown: ${pruneUnknown})`, async () => {
					const filePath = join(tempDir, "config.json");
					const fields: FieldsDef = { [name]: def, token: { type: "string" } };
					const store = createStore({ dirPath: tempDir, name: "config", pruneUnknown, fields });
					const expectMissing = (document: Awaited<ReturnType<typeof store.read>>) => {
						expect(Object.getPrototypeOf(document)).toBe(Object.prototype);
						expect(Object.entries(document)).toEqual([[name, undefined]]);
						// Non-colliding optional fields stay omitted.
						expect(Object.hasOwn(document, "token")).toBe(false);
					};

					expectMissing(await store.read());
					expectMissing(await store.patch({}));
					expectMissing(await store.update((current) => current));
					expectMissing(await store.write({}));
					expect(await readFile(filePath, "utf-8")).toBe("{}");
					expectMissing(await store.read());

					expect(Object.entries(await store.patch({ [name]: "v" }))).toEqual([[name, "v"]]);
					expect(JSON.parse(await readFile(filePath, "utf-8"))).toEqual(
						JSON.parse(`{"${name}":"v"}`),
					);
					expect(Object.entries(await store.read())).toEqual([[name, "v"]]);
				});
			}
		}
	}
});

// ────────────────────────────────────────────────────────────────────────────
// Unknown keys
// ────────────────────────────────────────────────────────────────────────────

describe("unknown persisted keys", () => {
	const NEWER_FIELDS = {
		name: { type: "string" },
		theme: { type: "string" },
	} as const satisfies FieldsDef;
	const OLDER_FIELDS = { name: { type: "string" } } as const satisfies FieldsDef;

	it("survive every mutation by default while read() returns only declared fields", async () => {
		const filePath = join(tempDir, "config.json");
		const newer = createStore({ dirPath: tempDir, name: "config", fields: NEWER_FIELDS });
		const older = createStore({ dirPath: tempDir, name: "config", fields: OLDER_FIELDS });
		await newer.write({ name: "Ada", theme: "solarized" });

		expect(await older.read()).toEqual({ name: "Ada" });
		expect(await older.patch({ name: "Ada L." })).toEqual({ name: "Ada L." });
		expect(await older.update((current) => ({ ...current, name: "Ada K." }))).toEqual({
			name: "Ada K.",
		});
		expect(await older.write({ name: "Grace" })).toEqual({ name: "Grace" });

		expect(JSON.parse(await readFile(filePath, "utf-8"))).toEqual({
			name: "Grace",
			theme: "solarized",
		});
		expect(await newer.read()).toEqual({ name: "Grace", theme: "solarized" });
	});

	it("are dropped by the next mutation with pruneUnknown: true", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ name: "Ada", theme: "solarized" }));
		const older = createStore({
			dirPath: tempDir,
			name: "config",
			fields: OLDER_FIELDS,
			pruneUnknown: true,
		});

		expect(await older.read()).toEqual({ name: "Ada" });
		expect(JSON.parse(await readFile(filePath, "utf-8"))).toEqual({
			name: "Ada",
			theme: "solarized",
		});
		await older.patch({ name: "Ada L." });
		expect(JSON.parse(await readFile(filePath, "utf-8"))).toEqual({ name: "Ada L." });
	});

	it("do not stop write() from replacing a corrupt file", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, "{oops");
		const store = createStore({ dirPath: tempDir, name: "config", fields: OLDER_FIELDS });

		await expect(store.patch({ name: "x" })).rejects.toMatchObject({
			code: "PARSE",
			message: `Malformed JSON in store file: ${filePath}`,
		});
		await store.write({ name: "Ada" });
		expect(JSON.parse(await readFile(filePath, "utf-8"))).toEqual({ name: "Ada" });
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Serialized mutations and the cross-process lock
// ────────────────────────────────────────────────────────────────────────────

describe("concurrent mutations", () => {
	const COUNTER_FIELDS = { n: { type: "number", default: 0 } } as const satisfies FieldsDef;
	const counter = () => createStore({ dirPath: tempDir, name: "counter", fields: COUNTER_FIELDS });

	it("keeps every overlapping update and patch, across store instances", async () => {
		const a = counter();
		const b = counter();
		await Promise.all(
			Array.from({ length: 10 }, (_, index) =>
				index % 2 === 0
					? a.update((current) => ({ n: current.n + 1 }))
					: b.update((current) => ({ n: current.n + 1 })),
			),
		);
		expect(await a.read()).toEqual({ n: 10 });
		expect(await readdir(tempDir)).toEqual(["counter.json"]);
	});

	it("runs mutations in call order and keeps going after a failure", async () => {
		const store = counter();
		const results = await Promise.allSettled([
			store.write({ n: 1 }),
			store.update((current) => ({ n: current.n * 10 })),
			store.update(() => {
				throw new Error("boom");
			}),
			store.patch({ n: Number.NaN }),
			store.update((current) => ({ n: current.n + 1 })),
			store.reset(),
			store.patch({ n: 7 }),
		]);

		expect(results.map((result) => result.status)).toEqual([
			"fulfilled",
			"fulfilled",
			"rejected",
			"rejected",
			"fulfilled",
			"fulfilled",
			"fulfilled",
		]);
		expect(results[4]).toEqual({ status: "fulfilled", value: { n: 11 } });
		expect(await store.read()).toEqual({ n: 7 });
		expect(await readdir(tempDir)).toEqual(["counter.json"]);
	});

	it("waits for a live lock and takes over a stale one", async () => {
		const lockPath = join(tempDir, "counter.json.lock");
		const store = counter();

		// Another machine's pid says nothing about its process, so its fresh lock is waited on.
		await writeFile(lockPath, JSON.stringify({ pid: 2 ** 31 - 2, host: "elsewhere" }));
		let settled = false;
		const pending = store.patch({ n: 1 }).finally(() => {
			settled = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(settled).toBe(false);
		await rm(lockPath);
		expect(await pending).toEqual({ n: 1 });

		// A process that no longer exists left its lock behind.
		await writeFile(lockPath, JSON.stringify({ pid: 2 ** 31 - 2, host: hostname() }));
		expect(await store.patch({ n: 2 })).toEqual({ n: 2 });

		// A lock older than the stale threshold is abandoned even when its pid is alive.
		await writeFile(lockPath, JSON.stringify({ pid: process.pid, host: hostname() }));
		const longAgo = new Date(Date.now() - 60_000);
		await utimes(lockPath, longAgo, longAgo);
		expect(await store.patch({ n: 3 })).toEqual({ n: 3 });
		expect(await readdir(tempDir)).toEqual(["counter.json"]);
	});

	// Every owner exits right after releasing, so a waiter can read one owner's pid, find that
	// process gone, and by then be looking at the next owner's lock.
	it("leaves a successor's lock alone when the owner it read has since exited", async () => {
		const lockPath = join(tempDir, "counter.json.lock");
		const gone = 2 ** 31 - 2;
		const successor = JSON.stringify({ pid: process.ppid, host: hostname() });
		await writeFile(lockPath, JSON.stringify({ pid: gone, host: hostname() }));
		const kill = process.kill.bind(process);
		const spy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			// The owner released and exited, and a successor took the lock, before this check.
			if (pid === gone) writeFileSync(lockPath, successor);
			return kill(pid, signal);
		});
		let settled = false;
		const pending = counter()
			.patch({ n: 1 })
			.finally(() => {
				settled = true;
			});

		await new Promise((resolve) => setTimeout(resolve, 100));
		spy.mockRestore();
		expect(settled).toBe(false);
		expect(readFileSync(lockPath, "utf-8")).toBe(successor);
		await rm(lockPath);
		expect(await pending).toEqual({ n: 1 });
	});

	it("does not remove a lock that another process took over", async () => {
		const lockPath = join(tempDir, "counter.json.lock");
		const other = JSON.stringify({ pid: process.ppid, host: hostname() });
		const store = createStore({
			dirPath: tempDir,
			name: "counter",
			fields: {
				n: {
					type: "number",
					default: 0,
					// Runs inside the lock: another process replaces this mutation's lock.
					validate: () => writeFileSync(lockPath, other),
				},
			},
		});

		await store.patch({ n: 1 });

		expect(readFileSync(lockPath, "utf-8")).toBe(other);
	});

	it("does not create a missing directory to reset", async () => {
		const dirPath = join(tempDir, "missing");
		await createStore({ dirPath, name: "counter", fields: COUNTER_FIELDS }).reset();
		expect(existsSync(dirPath)).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Aborting a mutation that waits
// ────────────────────────────────────────────────────────────────────────────

describe("mutation signal", () => {
	const COUNTER_FIELDS = { n: { type: "number", default: 0 } } as const satisfies FieldsDef;

	it.each([false, true])(
		"rejects a mutation queued behind another with the signal's reason (strict: %s)",
		async (strict) => {
			const dirPath = join(tempDir, "private");
			let release!: () => void;
			let entered!: () => void;
			const inside = new Promise<void>((resolve) => {
				entered = resolve;
			});
			const store = createStore({ dirPath, name: "counter", fields: COUNTER_FIELDS, strict });
			const blocker = createStore({
				dirPath,
				name: "counter",
				strict,
				fields: {
					n: {
						type: "number",
						default: 0,
						validate: () =>
							new Promise<void>((resolve) => {
								release = resolve;
								entered();
							}),
					},
				},
			});
			const holding = blocker.patch({ n: 1 });
			await inside;
			const controller = new AbortController();
			const queued = store.patch({ n: 2 }, { signal: controller.signal });
			const reason = new Error("stop");

			controller.abort(reason);

			await expect(queued).rejects.toBe(reason);
			await expect(store.reset({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
			release();
			expect(await holding).toEqual({ n: 1 });
			expect(await store.read()).toEqual({ n: 1 });
			expect(await readdir(dirPath)).toEqual(["counter.json"]);
		},
	);

	it("rejects a mutation waiting for another process's lock, leaving it", async () => {
		const lockPath = join(tempDir, "counter.json.lock");
		const foreign = JSON.stringify({ pid: 2 ** 31 - 2, host: "elsewhere" });
		await writeFile(lockPath, foreign);
		const controller = new AbortController();
		const reason = new Error("stop");
		setTimeout(() => controller.abort(reason), 50);

		await expect(
			createStore({ dirPath: tempDir, name: "counter", fields: COUNTER_FIELDS }).reset({
				signal: controller.signal,
			}),
		).rejects.toBe(reason);
		expect(readFileSync(lockPath, "utf-8")).toBe(foreign);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// strict
// ────────────────────────────────────────────────────────────────────────────

describe("strict", () => {
	let dirPath: string;
	beforeEach(() => {
		// A strict store creates its directory owner-only; the test's tempDir is not.
		dirPath = join(tempDir, "private");
	});
	const strictStore = () =>
		createStore({ dirPath, name: "auth", fields: BASIC_FIELDS, strict: true });

	it("cannot be combined with a non-private access", () => {
		expect(() =>
			createStore({
				dirPath,
				name: "auth",
				fields: BASIC_FIELDS,
				strict: true,
				access: { file: 0o640 },
			}),
		).toThrow(expect.objectContaining({ code: "DEFINITION" }));
		expect(() =>
			createStore({ dirPath, name: "auth", fields: BASIC_FIELDS, strict: true, access: "private" }),
		).not.toThrow();
	});

	it.skipIf(process.platform === "win32")(
		"writes the file owner-only in a directory it creates owner-only",
		async () => {
			const previous = process.umask(0o000);
			try {
				await strictStore().write({ theme: "dark", verbose: true });
			} finally {
				process.umask(previous);
			}

			expect((await stat(dirPath)).mode & 0o777).toBe(0o700);
			expect((await stat(join(dirPath, "auth.json"))).mode & 0o777).toBe(0o600);
		},
	);

	it.skipIf(process.platform === "win32")(
		"refuses an existing directory others can read, and creates nothing in it",
		async () => {
			await chmod(tempDir, 0o755);
			const store = createStore({
				dirPath: tempDir,
				name: "auth",
				fields: BASIC_FIELDS,
				strict: true,
			});

			await expect(store.write({ theme: "dark", verbose: true })).rejects.toMatchObject({
				code: "PATH",
				details: { path: tempDir, reason: "directory" },
			});
			expect(await readdir(tempDir)).toEqual([]);
		},
	);

	it("does not create a missing directory to reset", async () => {
		await strictStore().reset();
		expect(existsSync(dirPath)).toBe(false);
	});

	describe("a symbolic link at the store file", () => {
		let target: string;
		beforeEach(async () => {
			await strictStore().write({ theme: "dark", verbose: true });
			target = join(tempDir, "target.json");
			await writeFile(target, JSON.stringify({ theme: "light" }));
			await rm(join(dirPath, "auth.json"));
			await symlink(target, join(dirPath, "auth.json"), "file");
		});

		it.each([
			["read", (store: ReturnType<typeof strictStore>) => store.read()],
			["write", (store) => store.write({ theme: "dark", verbose: false })],
			["update", (store) => store.update((current) => current)],
			["patch", (store) => store.patch({ verbose: true })],
			["reset", (store) => store.reset()],
		] satisfies [string, (store: ReturnType<typeof strictStore>) => Promise<unknown>][])(
			"is refused by %s, which leaves the link and its target alone",
			async (_operation, run) => {
				await expect(run(strictStore())).rejects.toMatchObject({
					code: "PATH",
					details: { path: join(dirPath, "auth.json"), reason: "symlink" },
				});
				expect((await lstat(join(dirPath, "auth.json"))).isSymbolicLink()).toBe(true);
				expect(await readFile(target, "utf-8")).toBe(JSON.stringify({ theme: "light" }));
				expect((await readdir(dirPath)).toSorted()).toEqual(["auth.json"]);
			},
		);
	});

	// A junction can only point at a directory; whether lstat reports one as a link is what
	// decides that Windows refuses it rather than failing to read a directory.
	it.runIf(process.platform === "win32")("refuses a junction at the store file", async () => {
		await strictStore().write({ theme: "dark", verbose: true });
		await rm(join(dirPath, "auth.json"));
		const target = join(tempDir, "junction-target");
		await mkdir(target);
		await symlink(target, join(dirPath, "auth.json"), "junction");

		expect((await lstat(join(dirPath, "auth.json"))).isSymbolicLink()).toBe(true);
		await expect(strictStore().read()).rejects.toMatchObject({
			code: "PATH",
			details: { reason: "symlink" },
		});
		await expect(strictStore().write({ theme: "dark", verbose: true })).rejects.toMatchObject({
			code: "PATH",
			details: { reason: "symlink" },
		});
		expect(await readdir(target)).toEqual([]);
	});
});
