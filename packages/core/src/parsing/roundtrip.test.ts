import { inspect, isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "vite-plus/test";

import { makeNode } from "../../tests/helpers.ts";
import { resolveTypedPath } from "../command/invocation.ts";
import type { CommandNode } from "../command/node.ts";
import { resolveCommand, type CommandRoute } from "../command/router.ts";
import { CrustError } from "../errors.ts";
import type {
	ArgDef,
	FlagDef,
	ParseResult,
	RunInputPayload,
	RunInputValue,
	ValidatedInput,
} from "../types.ts";
import { parseArgs, parseStructured, validateParsed } from "./parser.ts";
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
});
