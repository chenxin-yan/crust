import { inspect, isDeepStrictEqual } from "node:util";

import type { StandardSchema } from "@crustjs/utils/schema";
import { describe, expect, it } from "vite-plus/test";

import { makeNode } from "../../tests/helpers.ts";
import { resolveTypedPath } from "../command/invocation.ts";
import type { CommandNode } from "../command/node.ts";
import { resolveCommand, type CommandRoute } from "../command/router.ts";
import { CrustError } from "../errors.ts";
import type { ArgDef, FlagDef, ParseResult, ValidatedInput } from "../types.ts";
import {
	parseArgs,
	parseStructured,
	type RunInputPayload,
	type RunInputValue,
	validateParsed,
} from "./parser.ts";
import { applySchemas } from "./schema.ts";
import { isFlagNegatable } from "./spellings.ts";

// Maintainer-only property: structured `run()` input and its argv spelling bind to the same
// values through the production router, parser, validation, and Standard Schemas. Everything
// here is test-local; there is no public generator or binding API.

const DEFAULT_SEED = 0x5eed;
/** Draws per case before a definition is reported as not encodable on argv. */
const MAX_ENCODE_ATTEMPTS = 100;

/** What a Command Action would receive, without running it. */
interface Bound extends ValidatedInput {
	readonly commandPath: readonly string[];
	readonly rawArgs: readonly string[];
}

type Attempt =
	| { readonly ok: true; readonly bound: Bound }
	| { readonly ok: false; readonly error: CrustError };

/** Production parse/validation failures are outcomes to compare; anything else is a bug. */
async function bind(resolve: () => { route: CommandRoute; parsed: ParseResult }): Promise<Attempt> {
	try {
		const { route, parsed } = resolve();
		validateParsed(route.command, parsed);
		const { args, flags } = await applySchemas(route.command, parsed);
		return {
			ok: true,
			bound: { commandPath: route.commandPath, args, flags, rawArgs: parsed.rawArgs },
		};
	} catch (error) {
		if (error instanceof CrustError) return { ok: false, error };
		throw error;
	}
}

/** Argv binds against an empty environment so `env` flags fall back to `default` like structured input. */
function bindArgv(root: CommandNode, argv: readonly string[]): Promise<Attempt> {
	return bind(() => {
		const route = resolveCommand(root, [...argv]);
		return { route, parsed: parseArgs(route.command, route.argv, {}) };
	});
}

function bindStructured(
	root: CommandNode,
	path: readonly string[],
	input: RunInputPayload,
): Promise<Attempt> {
	return bind(() => {
		const route = resolveTypedPath(root, path);
		return { route, parsed: parseStructured(route.command, input) };
	});
}

function describeAttempt(attempted: Attempt): string {
	return attempted.ok
		? inspect(attempted.bound, { depth: null })
		: `${attempted.error.code}: ${attempted.error.message}`;
}

/** One structured input and the argv spelling expected to bind identically. */
interface RoundTripCase {
	readonly input: RunInputPayload;
	readonly argv: readonly string[];
}

/** Bind one case both ways and require the same result. */
async function checkCase(
	root: CommandNode,
	path: readonly string[],
	{ input, argv }: RoundTripCase,
	allowRejection: boolean,
	context: string,
): Promise<"accepted" | "rejected"> {
	const fromStructured = await bindStructured(root, path, input);
	const fromArgv = await bindArgv(root, argv);
	const fail = (reason: string): never => {
		throw new Error(
			[
				reason,
				context,
				`path:       ${inspect(path)}`,
				`input:      ${inspect(input, { depth: null })}`,
				`argv:       ${inspect(argv)}`,
				`structured: ${describeAttempt(fromStructured)}`,
				`argv path:  ${describeAttempt(fromArgv)}`,
			].join("\n"),
		);
	};

	if (fromStructured.ok && fromArgv.ok) {
		// Native deep equality compares URLs by value and tolerates cyclic schema output.
		if (!isDeepStrictEqual(fromStructured.bound, fromArgv.bound)) {
			return fail("structured and argv binding diverged");
		}
		return "accepted";
	}
	if (fromStructured.ok || fromArgv.ok) return fail("one path rejected input the other accepted");
	if (!allowRejection) {
		return fail("both paths rejected a generated case for built-in definitions");
	}
	if (fromStructured.error.code !== fromArgv.error.code) {
		return fail("both paths rejected with different error codes");
	}
	return "rejected";
}

type Random = () => number;

/** mulberry32: small, fast, and deterministic for a 32-bit seed. */
function mulberry32(seed: number): Random {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function int(random: Random, max: number): number {
	return Math.floor(random() * max);
}

function pick<T>(random: Random, pool: readonly T[]): T {
	// SAFETY: pools are non-empty literals or choices checked by the argument/flag generators.
	return pool[int(random, pool.length)]!;
}

const STRINGS = ["", "origin", "main", "with space", "a=b", "ünïcödé", "42", "true", "null"];
const PATHS = ["src/index.ts", "./dist", "../shared", "~/projects", "/tmp/out", "a b/c.txt"];
const URLS = ["https://example.com/", "http://localhost:3000/api?x=1", "file:///tmp/a.txt"];
const RAW = ["--literal", "-x", "--", "plain", ""];
/** Argv cannot express a leading dash before `--`, so positional numbers stay non-negative. */
const POSITIONAL_NUMBERS = [0, 1, 42, 3.5, 0.1, 1e21];
const FLAG_NUMBERS = [...POSITIONAL_NUMBERS, -3, -0.5];

function jsonScalar(random: Random): string | number | boolean | null {
	switch (int(random, 4)) {
		case 0:
			return pick(random, STRINGS);
		case 1:
			return pick(random, FLAG_NUMBERS);
		case 2:
			return random() < 0.5;
		default:
			return null;
	}
}

/** Arrays are frequent on purpose: a JSON array must stay one value, never occurrences. */
function json(random: Random): RunInputValue {
	const shape = int(random, 3);
	if (shape === 0) return jsonScalar(random);
	if (shape === 1) return Array.from({ length: int(random, 4) }, () => jsonScalar(random));
	return { id: jsonScalar(random), tags: [jsonScalar(random)] };
}

/** One generated scalar with the argv token that the production parser binds to the same value. */
interface Encoded {
	readonly value: RunInputValue;
	readonly token: string;
}

function scalar(random: Random, def: ArgDef | FlagDef, positional: boolean): Encoded {
	if (def.choices) {
		const value = pick(random, def.choices);
		return { value, token: value };
	}
	// Schema-backed args carry no `type`; their schema receives the raw string on both paths.
	switch (def.type ?? "string") {
		case "number": {
			const value = pick(random, positional ? POSITIONAL_NUMBERS : FLAG_NUMBERS);
			return { value, token: String(value) };
		}
		case "boolean": {
			const value = random() < 0.5;
			return { value, token: String(value) };
		}
		case "path": {
			const value = pick(random, PATHS);
			return { value, token: value };
		}
		case "url": {
			const token = pick(random, URLS);
			return { value: new URL(token), token };
		}
		case "json": {
			const value = json(random);
			return { value, token: JSON.stringify(value) };
		}
		default: {
			const value = pick(random, STRINGS);
			return { value, token: value };
		}
	}
}

function mustSupply(def: ArgDef | FlagDef): boolean {
	return def.required === true && def.default === undefined;
}

function generateArgs(random: Random, defs: readonly ArgDef[]) {
	// Null prototype: core accepts a positional named `__proto__`, which plain
	// assignment would turn into a prototype swap instead of an own property.
	const args: Record<string, RunInputValue> = Object.create(null);
	const tokens: string[] = [];
	// Structured input rejects positional gaps, so supply a prefix that covers every required arg.
	const lastRequired = defs.findLastIndex(mustSupply);
	const empty = defs.find((def) => def.choices?.length === 0);
	const available = empty ? defs.indexOf(empty) : defs.length;
	if (empty && lastRequired >= available) {
		throw new Error(
			`cannot generate required positional prefix: "${empty.name}" has empty choices`,
		);
	}
	// An empty choice domain can only be omitted, along with all following positionals.
	const supplied = lastRequired + 1 + int(random, available - lastRequired);
	for (const def of defs.slice(0, supplied)) {
		const count = def.variadic ? (mustSupply(def) ? 1 : 0) + int(random, 3) : 1;
		const items = Array.from({ length: count }, () => scalar(random, def, true));
		args[def.name] = def.variadic ? items.map((item) => item.value) : items[0]!.value;
		tokens.push(...items.map((item) => item.token));
	}
	return { args, tokens };
}

function generateFlags(random: Random, defs: Readonly<Record<string, FlagDef>>) {
	const flags: Record<string, RunInputValue> = Object.create(null);
	const tokens: string[] = [];
	const encode = (name: string, def: FlagDef): Encoded => {
		if (def.type === "boolean") {
			// `--no-<name>` is the only argv spelling of false; opted-out flags only ever say true.
			const value = isFlagNegatable(def) ? random() < 0.5 : true;
			return { value, token: value ? `--${name}` : `--no-${name}` };
		}
		// A `delimiter` splits argv occurrences and drops empty segments, but never touches
		// structured values, so a token containing it (or an empty token) is not equivalent.
		for (let draw = 0; draw < MAX_ENCODE_ATTEMPTS; draw++) {
			const item = scalar(random, def, false);
			if (
				def.delimiter !== undefined &&
				(item.token === "" || item.token.includes(def.delimiter))
			) {
				continue;
			}
			return { value: item.value, token: `--${name}=${item.token}` };
		}
		throw new Error(
			`could not draw a value for "--${name}" without its delimiter ${inspect(def.delimiter)} after ${MAX_ENCODE_ATTEMPTS} attempts`,
		);
	};
	for (const [name, def] of Object.entries(defs)) {
		if (def.choices?.length === 0) {
			if (mustSupply(def)) {
				throw new Error(`cannot generate required flag "--${name}": choices is empty`);
			}
			continue;
		}
		if (!mustSupply(def) && random() < 0.5) continue;
		// Zero occurrences is an empty array on the structured side and nothing on argv.
		const count = def.multiple ? (mustSupply(def) ? 1 : 0) + int(random, 3) : 1;
		const items = Array.from({ length: count }, () => encode(name, def));
		flags[name] = def.multiple ? items.map((item) => item.value) : items[0]!.value;
		tokens.push(...items.map((item) => item.token));
	}
	return { flags, tokens };
}

function generateCase(
	random: Random,
	command: CommandNode,
	path: readonly string[],
	reserved: ReadonlySet<string>,
): RoundTripCase {
	for (let draw = 0; draw < MAX_ENCODE_ATTEMPTS; draw++) {
		const positional = generateArgs(random, command.args);
		const named = generateFlags(random, command.effectiveFlags);
		// A dash-led positional would parse as a flag; a reserved first positional would route
		// into a subcommand. Both are unreachable from argv, so draw again.
		const [first] = positional.tokens;
		if (positional.tokens.some((token) => token.startsWith("-"))) continue;
		if (first !== undefined && reserved.has(first)) continue;

		const input: RunInputPayload = { args: positional.args, flags: named.flags };
		const argv = [...path, ...positional.tokens, ...named.tokens];
		if (random() < 0.3) {
			const raw = Array.from({ length: int(random, 4) }, () => pick(random, RAW));
			return { input: { ...input, raw }, argv: [...argv, "--", ...raw] };
		}
		return { input, argv };
	}
	throw new Error(
		`could not encode a case for [${path.join(", ")}] on argv after ${MAX_ENCODE_ATTEMPTS} attempts; a positional definition only accepts dash-led values or subcommand names.`,
	);
}

interface RoundTripReport {
	readonly seed: number;
	readonly runs: number;
	/** Cases both paths bound to deep-equal values. */
	readonly accepted: number;
	/** Cases both paths rejected with the same `CrustError` code; only possible with `parse`/`schema`. */
	readonly rejected: number;
}

/**
 * Generate `runs` cases from the command's own definitions and bind each twice. Author `parse`
 * and schema callbacks run as validators and may reject the generated raw string; matching
 * `CrustError` codes count as `rejected` only for commands that declare them. Throws with the
 * seed and case on the first divergence, and when no case was accepted (no evidence).
 */
async function roundTrip(
	root: CommandNode,
	path: readonly string[],
	{ runs, seed = DEFAULT_SEED }: { runs: number; seed?: number },
): Promise<RoundTripReport> {
	// Resolves the path first, so an unknown path throws COMMAND_NOT_FOUND.
	const { command } = resolveTypedPath(root, path);
	const isCustom = (def: ArgDef | FlagDef) => def.parse !== undefined || def.schema !== undefined;
	const allowRejection =
		command.args.some(isCustom) || Object.values(command.effectiveFlags).some(isCustom);
	const reserved = new Set(
		Object.entries(command.subCommands).flatMap(([name, child]) => [
			name,
			...(child.meta.aliases ?? []),
		]),
	);

	const random = mulberry32(seed);
	let accepted = 0;
	let rejected = 0;
	for (let index = 0; index < runs; index++) {
		const outcome = await checkCase(
			root,
			path,
			generateCase(random, command, path, reserved),
			allowRejection,
			`seed ${seed}, case ${index + 1} of ${runs}; reproduce with { seed: ${seed} }`,
		);
		if (outcome === "accepted") accepted++;
		else rejected++;
	}
	if (accepted === 0) {
		throw new Error(
			`every case was rejected by parse/schema callbacks (seed ${seed}, ${runs} runs); the property has no equivalence evidence`,
		);
	}
	return { seed, runs, accepted, rejected };
}

type StandardInput = Parameters<StandardSchema["~standard"]["validate"]>[0];

/** Minimal hand-rolled Standard Schema (no vendor dependency). */
function schema<Input, Output>(
	validate: (value: Input) => { value: Output } | { issues: { message: string }[] },
): StandardSchema<Input, Output> {
	return {
		"~standard": {
			version: 1,
			vendor: "crust-test",
			validate: (value: StandardInput) => validate(value as Input),
		},
	};
}

/** Every built-in shape the generator derives from a definition, behind an aliased subcommand. */
function fixture(): CommandNode {
	const remoteAdd = makeNode({
		meta: "remote-add",
		args: [
			{ name: "name", type: "string", required: true },
			{ name: "count", type: "number", required: true },
			{ name: "payload", type: "json" },
			{ name: "mode", type: "string", choices: ["safe", "fast"], default: "safe" },
			{ name: "files", type: "path", variadic: true },
		],
		flags: {
			fetch: { type: "boolean" },
			quiet: { type: "boolean", noNegate: true, multiple: true },
			tag: { type: "string", multiple: true },
			config: { type: "json" },
			offset: { type: "number", default: 7 },
			level: { type: "string", choices: ["debug", "info"], required: true },
			upstream: { type: "url" },
			out: { type: "path", default: "./dist" },
			flag: { type: "boolean", required: true },
		},
		run: () => {},
	});
	remoteAdd.meta.aliases = ["ra"];
	return makeNode({ meta: "git", subCommands: { "remote-add": remoteAdd } });
}

describe("structured/argv round trip", () => {
	it("binds every generated built-in case identically, through the canonical name and an alias", async () => {
		const root = fixture();
		expect(await roundTrip(root, ["remote-add"], { runs: 300 })).toEqual({
			seed: DEFAULT_SEED,
			runs: 300,
			accepted: 300,
			rejected: 0,
		});
		expect(await roundTrip(root, ["ra"], { runs: 20 })).toMatchObject({ accepted: 20 });
		expect(await bindArgv(root, ["ra", "origin", "1", "--level=info", "--flag"])).toMatchObject({
			ok: true,
			bound: { commandPath: ["git", "remote-add"] },
		});
	});

	it("is deterministic for a seed and varies across seeds", async () => {
		const seen = async (seed: number) => {
			const raws: string[] = [];
			const root = makeNode({
				meta: "cli",
				args: [{ name: "target", type: "string" }],
				flags: { level: { type: "string", parse: (raw) => (raws.push(raw), raw) } },
				run: () => {},
			});
			const report = await roundTrip(root, [], { runs: 30, seed });
			return { report, raws };
		};

		const first = await seen(7);
		const second = await seen(7);
		const third = await seen(8);
		expect(first.report).toEqual({ seed: 7, runs: 30, accepted: 30, rejected: 0 });
		expect(second.raws).toEqual(first.raws);
		expect(third.raws).not.toEqual(first.raws);
	});

	it("honors choices and requiredness in generated values", async () => {
		const modes: string[] = [];
		const root = makeNode({
			meta: "cli",
			args: [
				{
					name: "mode",
					type: "string",
					choices: ["safe", "fast"],
					required: true,
					parse: (raw) => (modes.push(raw), raw),
				},
				{ name: "files", type: "string", variadic: true, required: true },
			],
			flags: { tag: { type: "string", multiple: true, required: true } },
			run: () => {},
		});

		// Out-of-range choices or a missing required value would reject on both paths, which the
		// property reports as a generator failure rather than a rejected case.
		expect(await roundTrip(root, [], { runs: 50 })).toEqual({
			seed: DEFAULT_SEED,
			runs: 50,
			accepted: 50,
			rejected: 0,
		});
		expect(modes.length).toBe(100);
		expect(new Set(modes)).toEqual(new Set(["safe", "fast"]));
	});

	it.each([false, true])("omits flags with empty choices (multiple: %s)", async (multiple) => {
		const root = makeNode({
			meta: "cli",
			flags: { mode: { type: "string", choices: [], ...(multiple ? { multiple: true } : {}) } },
			run: () => {},
		});
		expect(await roundTrip(root, [], { seed: 1, runs: 10 })).toMatchObject({ accepted: 10 });
	});

	it.each([false, true])(
		"omits positionals with empty choices (variadic: %s)",
		async (variadic) => {
			const root = makeNode({
				meta: "cli",
				args: [
					{ name: "mode", type: "string", choices: [], ...(variadic ? { variadic: true } : {}) },
				],
				run: () => {},
			});
			expect(await roundTrip(root, [], { seed: 1, runs: 10 })).toMatchObject({ accepted: 10 });
		},
	);

	it("stops the supplied positional prefix at an empty choice domain", async () => {
		const supplied: string[] = [];
		const root = makeNode({
			meta: "cli",
			args: [
				{
					name: "first",
					type: "string",
					required: true,
					parse: (raw) => (supplied.push(raw), raw),
				},
				{ name: "mode", type: "string", choices: [] },
				{
					name: "last",
					type: "string",
					parse: () => {
						throw new Error("positional gap");
					},
				},
			],
			run: () => {},
		});
		expect(await roundTrip(root, [], { seed: 1, runs: 10 })).toMatchObject({ accepted: 10 });
		expect(supplied).toHaveLength(20);
	});

	it("reports required definitions with empty choices instead of generating an impossible case", async () => {
		const flag = makeNode({
			meta: "cli",
			flags: { mode: { type: "string", choices: [], required: true } },
			run: () => {},
		});
		await expect(roundTrip(flag, [], { runs: 10 })).rejects.toThrow(
			'cannot generate required flag "--mode": choices is empty',
		);
		const arg = makeNode({
			meta: "cli",
			args: [{ name: "mode", type: "string", choices: [], required: true, variadic: true }],
			run: () => {},
		});
		await expect(roundTrip(arg, [], { runs: 10 })).rejects.toThrow(
			'cannot generate required positional prefix: "mode" has empty choices',
		);
	});

	it("never places a subcommand name or alias as the first positional", async () => {
		const firsts: string[] = [];
		const origin = makeNode({ meta: "origin", run: () => {} });
		origin.meta.aliases = ["main"];
		const root = makeNode({
			meta: "cli",
			args: [
				{ name: "target", type: "string", required: true, parse: (raw) => (firsts.push(raw), raw) },
			],
			subCommands: { origin },
			run: () => {},
		});

		expect(await roundTrip(root, [], { runs: 100 })).toMatchObject({ runs: 100, rejected: 0 });
		// Each accepted case binds the same raw value twice (structured, then argv).
		expect(firsts.length).toBe(200);
		expect(firsts).not.toContain("origin");
		expect(firsts).not.toContain("main");
	});

	it("binds prototype-named positionals, aliases, and flags as own properties", async () => {
		const serve = makeNode({
			meta: "serve",
			args: [{ name: "__proto__", type: "string", required: true }],
			flags: { hasOwnProperty: { type: "number" } },
			run: () => {},
		});
		serve.meta.aliases = ["constructor"];
		const root = makeNode({ meta: "cli", subCommands: { serve } });
		expect(await roundTrip(root, ["serve"], { runs: 25 })).toMatchObject({ accepted: 25 });
		expect(await roundTrip(root, ["constructor"], { runs: 25 })).toMatchObject({ accepted: 25 });
	});

	it("compares cyclic Standard Schema output without overflowing", async () => {
		interface Node {
			self?: Node;
		}
		const cyclic = schema<string | undefined, Node>(() => {
			const node: Node = {};
			node.self = node;
			return { value: node };
		});
		const root = makeNode({
			meta: "cli",
			args: [{ name: "graph", schema: cyclic }],
			run: () => {},
		});
		expect(await roundTrip(root, [], { runs: 10 })).toMatchObject({ accepted: 10 });
	});

	it("binds env-backed flags to their default on both paths regardless of the process environment", async () => {
		const name = "CRUST_TEST_ROUNDTRIP_ENV";
		const previous = process.env[name];
		process.env[name] = "ambient";
		try {
			const root = makeNode({
				meta: "cli",
				flags: { home: { type: "string", env: { name }, default: "fallback" } },
				run: () => {},
			});
			expect(await roundTrip(root, [], { runs: 20 })).toMatchObject({ accepted: 20 });
			expect(await bindArgv(root, [])).toMatchObject({
				ok: true,
				bound: { flags: { home: "fallback" } },
			});
		} finally {
			if (previous === undefined) delete process.env[name];
			else process.env[name] = previous;
		}
	});

	it("never generates a flag's delimiter inside a value", async () => {
		const root = makeNode({
			meta: "cli",
			flags: {
				tag: {
					type: "string",
					multiple: true,
					delimiter: ",",
					env: { name: "TAGS", delimiter: " " },
				},
				eq: { type: "string", multiple: true, delimiter: "=" },
				payload: { type: "json", multiple: true, delimiter: "," },
			},
			run: () => {},
		});
		expect(await roundTrip(root, [], { runs: 100 })).toMatchObject({ accepted: 100 });
	});

	it("rejects an unknown path with COMMAND_NOT_FOUND before generating anything", async () => {
		const root = makeNode({ meta: "cli", run: () => {} });
		await expect(roundTrip(root, ["missing"], { runs: 1 })).rejects.toMatchObject({
			code: "COMMAND_NOT_FOUND",
		});
	});

	it("fails with seed and case diagnostics when binding diverges", async () => {
		let calls = 0;
		const root = makeNode({
			meta: "cli",
			flags: { level: { type: "string", required: true, parse: () => calls++ } },
			run: () => {},
		});

		await expect(roundTrip(root, [], { runs: 5, seed: 11 })).rejects.toThrow(
			/structured and argv binding diverged\nseed 11, case 1 of 5; reproduce with \{ seed: 11 \}\n[\s\S]*input:[\s\S]*argv:[\s\S]*structured: \{[\s\S]*argv path:  \{/,
		);
	});

	it("counts parse/schema rejections honestly and refuses a run without accepted cases", async () => {
		const evens = makeNode({
			meta: "cli",
			args: [
				{
					name: "port",
					schema: schema<string | undefined, string>((raw) =>
						raw === undefined || raw.length % 2 === 0
							? { value: raw ?? "none" }
							: { issues: [{ message: "odd length" }] },
					),
				},
			],
			run: () => {},
		});
		const report = await roundTrip(evens, [], { runs: 60 });
		expect(report.accepted + report.rejected).toBe(60);
		expect(report.accepted).toBeGreaterThan(0);
		expect(report.rejected).toBeGreaterThan(0);

		const never = makeNode({
			meta: "cli",
			flags: {
				level: {
					type: "string",
					required: true,
					parse: () => {
						throw new Error("always invalid");
					},
				},
			},
			run: () => {},
		});
		await expect(roundTrip(never, [], { runs: 3 })).rejects.toThrow(
			"every case was rejected by parse/schema callbacks",
		);
	});
});

describe("structured/argv round trip — pinned cases", () => {
	const root = makeNode({
		meta: "cli",
		args: [{ name: "payload", type: "json" }],
		flags: { config: { type: "json" }, tag: { type: "string", multiple: true } },
		run: () => {},
	});

	it("accepts JSON arrays as single values on both paths", async () => {
		const outcome = await checkCase(
			root,
			[],
			{
				input: { args: { payload: [1, 2] }, flags: { config: [3, 4], tag: ["a", "b"] } },
				argv: ["[1,2]", "--config=[3,4]", "--tag=a", "--tag=b"],
			},
			false,
			"pinned",
		);
		expect(outcome).toBe("accepted");
	});

	it("detects a JSON array wrongly expanded into repeated occurrences", async () => {
		// The parser keeps the last occurrence of a scalar flag, so the expansion silently binds 4.
		await expect(
			checkCase(
				root,
				[],
				{ input: { flags: { config: [3, 4] } }, argv: ["--config=3", "--config=4"] },
				false,
				"pinned",
			),
		).rejects.toThrow(
			/binding diverged[\s\S]*structured: [\s\S]*config: \[ 3, 4 \][\s\S]*argv path: [\s\S]*config: 4/,
		);
		await expect(
			checkCase(
				root,
				[],
				{ input: { args: { payload: [1, 2] } }, argv: ["1", "2"] },
				false,
				"pinned",
			),
		).rejects.toThrow("one path rejected input the other accepted");
		await expect(
			checkCase(
				root,
				[],
				{ input: { flags: { tag: ["a", "b"] } }, argv: ["--tag=b", "--tag=a"] },
				false,
				"pinned",
			),
		).rejects.toThrow("structured and argv binding diverged");
	});

	it("detects a delimiter splitting an argv value that structured input keeps whole", async () => {
		const delimited = makeNode({
			meta: "cli",
			flags: { tag: { type: "string", multiple: true, delimiter: "," } },
			run: () => {},
		});
		await expect(
			checkCase(
				delimited,
				[],
				{ input: { flags: { tag: ["a,b"] } }, argv: ["--tag=a,b"] },
				false,
				"pinned",
			),
		).rejects.toThrow(
			/binding diverged[\s\S]*structured: [\s\S]*tag: \[ 'a,b' \][\s\S]*argv path: [\s\S]*tag: \[ 'a', 'b' \]/,
		);
		// An empty segment is dropped on argv but kept as a structured value.
		await expect(
			checkCase(
				delimited,
				[],
				{ input: { flags: { tag: [""] } }, argv: ["--tag="] },
				false,
				"pinned",
			),
		).rejects.toThrow("structured and argv binding diverged");
	});

	it("treats a shared rejection of built-in definitions as a failure, not a rejected case", async () => {
		const required = makeNode({
			meta: "cli",
			flags: { level: { type: "string", required: true } },
			run: () => {},
		});
		await expect(checkCase(required, [], { input: {}, argv: [] }, false, "pinned")).rejects.toThrow(
			"both paths rejected a generated case for built-in definitions",
		);
		expect(await checkCase(required, [], { input: {}, argv: [] }, true, "pinned")).toBe("rejected");
	});
});
