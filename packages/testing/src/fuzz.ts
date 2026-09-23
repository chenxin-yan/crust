import { inspect, isDeepStrictEqual } from "node:util";

import type {
	AnyCrust,
	ArgSnapshot,
	CommandPath,
	CommandShape,
	CommandSnapshot,
	FlagSnapshot,
	RunInput,
} from "@crustjs/core";
import { CrustError } from "@crustjs/core";
import { bindInput, customBindings, type BoundInput } from "@crustjs/core/tooling";

/** Environment variable that overrides the default seed when `seed` is not passed. */
const FUZZ_SEED_ENV = "CRUST_FUZZ_SEED";
const DEFAULT_SEED = 0x5eed;
const DEFAULT_RUNS = 100;
/** Draws per case before a definition is reported as not encodable on argv. */
const MAX_ENCODE_ATTEMPTS = 100;

export interface FuzzRoundTripOptions {
	/** Generated cases. Default `100`. */
	readonly runs?: number;
	/** PRNG seed; takes precedence over `CRUST_FUZZ_SEED`. */
	readonly seed?: number;
	/** Environment consulted for `CRUST_FUZZ_SEED`. Default `process.env`. */
	readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface FuzzRoundTripReport {
	/** Seed that reproduces this run. */
	readonly seed: number;
	readonly runs: number;
	/** Cases both paths bound to deep-equal values. */
	readonly accepted: number;
	/**
	 * Cases both paths rejected with the same `CrustError` code. Only possible when the
	 * command declares `parse` or Standard Schema definitions: their callbacks receive the
	 * generated raw string and may reject it.
	 */
	readonly rejected: number;
}

/** Runtime-erased structured value accepted by `run()`. */
type StructuredValue = Exclude<NonNullable<RunInput<CommandShape>["args"]>[string], undefined>;
type StructuredInput = RunInput<CommandShape>;

/** One generated scalar with the argv token that the production parser binds to the same value. */
interface Encoded {
	readonly value: StructuredValue;
	readonly token: string;
}

/** One structured input and the argv spelling expected to bind identically. */
export interface RoundTripCase {
	readonly input: StructuredInput;
	readonly argv: readonly string[];
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
	// SAFETY: every pool below is a non-empty literal array.
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
function json(random: Random): StructuredValue {
	const shape = int(random, 3);
	if (shape === 0) return jsonScalar(random);
	if (shape === 1) return Array.from({ length: int(random, 4) }, () => jsonScalar(random));
	return { id: jsonScalar(random), tags: [jsonScalar(random)] };
}

/** Generate one scalar for a definition together with its argv spelling. */
function scalar(random: Random, def: ArgSnapshot | FlagSnapshot, positional: boolean): Encoded {
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

function mustSupply(def: ArgSnapshot | FlagSnapshot): boolean {
	return def.required === true && def.default === undefined;
}

function generateArgs(random: Random, defs: readonly ArgSnapshot[]) {
	// Null prototype: core accepts a positional named `__proto__`, which plain
	// assignment would turn into a prototype swap instead of an own property.
	const args: Record<string, StructuredValue> = Object.create(null);
	const tokens: string[] = [];
	// Structured input rejects positional gaps, so supply a prefix that covers every required arg.
	const lastRequired = defs.findLastIndex(mustSupply);
	const supplied = lastRequired + 1 + int(random, defs.length - lastRequired);
	for (const def of defs.slice(0, supplied)) {
		if (def.variadic) {
			const count = (mustSupply(def) ? 1 : 0) + int(random, 3);
			const items = Array.from({ length: count }, () => scalar(random, def, true));
			args[def.name] = items.map((item) => item.value);
			tokens.push(...items.map((item) => item.token));
		} else {
			const item = scalar(random, def, true);
			args[def.name] = item.value;
			tokens.push(item.token);
		}
	}
	return { args, tokens };
}

function generateFlags(random: Random, defs: Readonly<Record<string, FlagSnapshot>>) {
	const flags: Record<string, StructuredValue> = Object.create(null);
	const tokens: string[] = [];
	const encode = (name: string, def: FlagSnapshot): Encoded => {
		if (def.type === "boolean") {
			// `--no-<name>` is the only argv spelling of false; opted-out flags only ever say true.
			const value = def.negatable ? random() < 0.5 : true;
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
			`fuzzRoundTrip: could not draw a value for "--${name}" without its delimiter ${inspect(def.delimiter)} after ${MAX_ENCODE_ATTEMPTS} attempts`,
		);
	};
	for (const [name, def] of Object.entries(defs)) {
		if (!mustSupply(def) && random() < 0.5) continue;
		if (def.multiple) {
			// Zero occurrences is an empty array on the structured side and nothing on argv.
			const count = (mustSupply(def) ? 1 : 0) + int(random, 3);
			const items = Array.from({ length: count }, () => encode(name, def));
			flags[name] = items.map((item) => item.value);
			tokens.push(...items.map((item) => item.token));
		} else {
			const item = encode(name, def);
			flags[name] = item.value;
			tokens.push(item.token);
		}
	}
	return { flags, tokens };
}

function generateCase(
	random: Random,
	command: CommandSnapshot,
	path: readonly string[],
	reserved: ReadonlySet<string>,
): RoundTripCase {
	for (let draw = 0; draw < MAX_ENCODE_ATTEMPTS; draw++) {
		const positional = generateArgs(random, command.args);
		const named = generateFlags(random, command.flags);
		// A dash-led positional would parse as a flag; a reserved first positional would route
		// into a subcommand. Both are unreachable from argv, so draw again.
		const [first] = positional.tokens;
		if (positional.tokens.some((token) => token.startsWith("-"))) continue;
		if (first !== undefined && reserved.has(first)) continue;

		const input: StructuredInput = { args: positional.args, flags: named.flags };
		const argv = [...path, ...positional.tokens, ...named.tokens];
		if (random() < 0.3) {
			const raw = Array.from({ length: int(random, 4) }, () => pick(random, RAW));
			return { input: { ...input, raw }, argv: [...argv, "--", ...raw] };
		}
		return { input, argv };
	}
	throw new Error(
		`fuzzRoundTrip: could not encode a case for [${path.join(", ")}] on argv after ${MAX_ENCODE_ATTEMPTS} attempts; a positional definition only accepts dash-led values or subcommand names.`,
	);
}

/**
 * Walk a snapshot along a typed path, accepting canonical names and aliases like the router.
 * Callers validate the path through `customBindings()` first, so every element resolves.
 */
function commandAt(root: CommandSnapshot, path: readonly string[]): CommandSnapshot {
	let command = root;
	for (const name of path) {
		// hasOwn like the router: an alias named `constructor` must not resolve to Object.
		const child = Object.hasOwn(command.subCommands, name)
			? command.subCommands[name]
			: Object.values(command.subCommands).find((candidate) =>
					candidate.meta.aliases?.includes(name),
				);
		if (!child) throw new Error(`fuzzRoundTrip: snapshot has no command "${name}"`);
		command = child;
	}
	return command;
}

type Attempt =
	| { readonly ok: true; readonly bound: BoundInput }
	| { readonly ok: false; readonly error: CrustError };

/** Production parse/validation failures are outcomes to compare; anything else is a bug. */
async function attempt(pending: Promise<BoundInput>): Promise<Attempt> {
	try {
		return { ok: true, bound: await pending };
	} catch (error) {
		if (error instanceof CrustError) return { ok: false, error };
		throw error;
	}
}

function describeAttempt(attempted: Attempt): string {
	return attempted.ok
		? inspect(attempted.bound, { depth: null })
		: `${attempted.error.code}: ${attempted.error.message}`;
}

function resolveSeed(options: FuzzRoundTripOptions): number {
	if (options.seed !== undefined) return options.seed >>> 0;
	const fromEnv = (options.env ?? process.env)[FUZZ_SEED_ENV];
	if (fromEnv === undefined || fromEnv === "") return DEFAULT_SEED;
	const parsed = Number(fromEnv);
	if (!Number.isInteger(parsed)) {
		throw new Error(`fuzzRoundTrip: ${FUZZ_SEED_ENV} must be an integer, got "${fromEnv}"`);
	}
	return parsed >>> 0;
}

/**
 * Bind one case both ways through the production parser and require the same result.
 * Exported for co-located tests that pin known-equivalent and known-divergent pairs; the
 * package entry point exposes {@link fuzzRoundTrip} only.
 */
export async function checkRoundTripCase(
	app: AnyCrust,
	path: readonly string[],
	{ input, argv }: RoundTripCase,
	allowRejection: boolean,
	context: string,
): Promise<"accepted" | "rejected"> {
	const fromStructured = await attempt(bindInput(app, { path, input }));
	const fromArgv = await attempt(bindInput(app, { argv }));
	const fail = (reason: string): never => {
		throw new Error(
			[
				`fuzzRoundTrip: ${reason}`,
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

/**
 * Property: structured `run()` input and its argv spelling bind to the same values.
 *
 * Derives generators from the command's snapshot (`type`, `choices`, `required`, `default`,
 * `variadic`, `multiple`, negation), then binds each case twice through
 * `bindInput()` from `@crustjs/core/tooling` — parse, validation, and Standard Schemas only.
 * Command Actions, Extension hooks, and Contexts never run. Definition materialization,
 * `parse` functions, and schemas do run. Custom `parse` callbacks receive individual strings,
 * one call per supplied occurrence. Schemas receive the whole parsed value (a string,
 * boolean, repeated-value array, or `undefined` when omitted). Matching `CrustError` codes
 * on both paths count as `rejected` only for commands that declare these validators.
 * Argv binds against an empty environment, so `env` flags fall back to `default` like
 * structured input; a flag's `delimiter` is never generated inside a value.
 *
 * Throws with the seed, case number, and both outcomes on the first divergence, and when no
 * case was accepted (the property then has no evidence).
 */
export async function fuzzRoundTrip<
	App extends AnyCrust,
	const Path extends CommandPath<App["_types"]["tree"]>,
>(app: App, path: Path, options: FuzzRoundTripOptions = {}): Promise<FuzzRoundTripReport> {
	const runs = options.runs ?? DEFAULT_RUNS;
	if (!Number.isInteger(runs) || runs < 1) {
		throw new Error(`fuzzRoundTrip: runs must be a positive integer, got ${inspect(runs)}`);
	}
	const seed = resolveSeed(options);
	// Resolves the path against the prepared tree first, so an unknown path throws COMMAND_NOT_FOUND.
	const custom = customBindings(app, path);
	const command = commandAt(await app.snapshot(), path);
	const allowRejection = custom.args.length > 0 || custom.flags.length > 0;
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
		const outcome = await checkRoundTripCase(
			app,
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
			`fuzzRoundTrip: every case was rejected by parse/schema callbacks (seed ${seed}, ${runs} runs); the property has no equivalence evidence. Definitions with callbacks: ${inspect(custom)}`,
		);
	}
	return { seed, runs, accepted, rejected };
}
