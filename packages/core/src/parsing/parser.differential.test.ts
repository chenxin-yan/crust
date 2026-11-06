import { parseArgs as nodeParseArgs, type ParseArgsOptionDescriptor } from "node:util";

import { describe, expect, it } from "vite-plus/test";

import { makeNode } from "../../tests/helpers.ts";
import { CrustError } from "../errors.ts";
import type { FlagDef, FlagsDef } from "../types.ts";
import { parseArgs } from "./parser.ts";

// ────────────────────────────────────────────────────────────────────────────
// Differential test — Crust's argv tokenizer against `node:util.parseArgs`
// (strict, `allowNegative`), the reference it replaced. Random flag specs and
// argv from a fixed seed, plus hand-picked edge cases, must produce the same
// canonical values, positionals, and errors in Crust's wording.
//
// The oracle adds what parseArgs cannot express: `noNegate` (a negated
// `noNegate` flag is an error at its argv position) and canonical names for
// aliases. Intentional differences, kept out of the generated inputs:
// - Shorts are one code point (`-😀`); parseArgs splits clusters by UTF-16 unit.
// - Bun's parseArgs names an unknown short `z` instead of `-z`; Crust always
//   uses Node's form, which is what this oracle (run on Node) reports.
// - `--=a=b` names the flag `=a`, where parseArgs names it the empty string.
// - `-` inside a cluster is an unknown short. parseArgs expands `-v-x` to
//   `-v --` and `-x`, silently turning the rest of argv into operands.
// ────────────────────────────────────────────────────────────────────────────

type Outcome =
	| {
			flags: Record<string, unknown>;
			positionals: readonly string[];
			operands: readonly string[];
	  }
	| { error: string; details: unknown };

interface Spelling {
	canonical: string;
	def: FlagDef;
	short: boolean;
}

function spellingTable(flags: FlagsDef): Map<string, Spelling> {
	const table = new Map<string, Spelling>();
	for (const [canonical, def] of Object.entries(flags)) {
		for (const spelling of [canonical, ...(def.aliases ?? [])])
			table.set(spelling, { canonical, def, short: false });
		if (def.short) table.set(def.short, { canonical, def, short: true });
	}
	return table;
}

function crustOutcome(flags: FlagsDef, argv: string[]): Outcome {
	try {
		const parsed = parseArgs(makeNode({ meta: "t", flags }), argv, {});
		return { flags: parsed.flags, positionals: parsed.excessArgs, operands: parsed.rawArgs };
	} catch (error) {
		if (!(error instanceof CrustError)) throw error;
		return { error: error.message, details: error.details };
	}
}

function oracleOutcome(flags: FlagsDef, argv: string[]): Outcome {
	const spellings = spellingTable(flags);
	const options: Record<string, ParseArgsOptionDescriptor> = {};
	for (const [spelling, { canonical, def, short }] of spellings) {
		if (short) continue;
		options[spelling] = {
			type: def.type === "boolean" ? "boolean" : "string",
			multiple: def.multiple === true,
			...(spelling === canonical && def.short ? { short: def.short } : {}),
		};
	}
	const config = { options, allowPositionals: true, allowNegative: true, tokens: true } as const;

	try {
		// Tokenizing does not depend on `strict`; the strict run checks every token before the negation.
		for (const token of nodeParseArgs({ ...config, args: argv, strict: false }).tokens) {
			if (token.kind !== "option" || !token.rawName.startsWith("--no-")) continue;
			const base = spellings.get(token.rawName.slice("--no-".length));
			if (!base || base.short || base.def.type !== "boolean" || !base.def.noNegate) continue;
			nodeParseArgs({ ...config, args: argv.slice(0, token.index), strict: true });
			return {
				error: `Flag "--${base.canonical}" does not support negation ("${token.rawName}")`,
				details: undefined,
			};
		}

		const { tokens } = nodeParseArgs({ ...config, args: argv, strict: true });
		const values: Record<string, unknown> = Object.fromEntries(
			Object.keys(flags).map((name) => [name, undefined]),
		);
		const positionals: string[] = [];
		const operands: string[] = [];
		let separated = false;
		for (const token of tokens) {
			if (token.kind === "option-terminator") separated = true;
			else if (token.kind === "positional") (separated ? operands : positionals).push(token.value);
			else {
				const { canonical, def } = spellings.get(token.name)!;
				const value = def.type === "boolean" ? !token.rawName.startsWith("--no-") : token.value;
				const existing = values[canonical];
				values[canonical] = def.multiple
					? [...(Array.isArray(existing) ? existing : []), value]
					: value;
			}
		}
		return { flags: values, positionals, operands };
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		const unknown = /^Unknown option '(.*?)'\./.exec(error.message)?.[1];
		if (unknown !== undefined) {
			return {
				error: `Unknown flag "${unknown}"`,
				details: { flag: unknown.replace(/^--?/, ""), reason: "unknown-flag" },
			};
		}
		const invalid =
			/^Option '(?:-., )?-{1,2}(.+?)(?: <value>)?' (argument missing|argument is ambiguous|does not take an argument)/.exec(
				error.message,
			);
		if (!invalid) throw error;
		const [, spelling = "", problem] = invalid;
		const flag = spellings.get(spelling)!.canonical;
		if (problem === "does not take an argument") {
			return {
				error: `Flag "--${flag}" does not take a value`,
				details: { flag, reason: "unexpected-value" },
			};
		}
		const hint =
			problem === "argument is ambiguous"
				? `; to pass a value starting with "-", write --${flag}=<value>`
				: "";
		return {
			error: `Missing value for flag "--${flag}"${hint}`,
			details: { flag, reason: "missing-value" },
		};
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Generators
// ────────────────────────────────────────────────────────────────────────────

/** mulberry32: a small seeded PRNG, so failures reproduce. */
function seeded(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Disjoint pools keep spellings unique; single-character names and aliases are reachable as `-q`/`-r`.
const NAMES = ["alpha", "beta", "q", "gamma"];
const SHORTS = ["a", "b", "c", "d"];
const ALIASES = ["al", "be", "r"];
const VALUES = ["v", "", "-", "-x", "--y", "--", "=", "a=b", "-a"];

function generateFlags(random: () => number): FlagsDef {
	const pick = <T>(items: T[]) => items.splice(Math.floor(random() * items.length), 1)[0]!;
	const names = [...NAMES];
	const shorts = [...SHORTS];
	const aliases = [...ALIASES];
	const flags: FlagsDef = {};
	for (let count = 1 + Math.floor(random() * names.length); count > 0; count--) {
		const shared = {
			...(random() < 0.6 ? { short: pick(shorts) } : {}),
			...(aliases.length > 0 && random() < 0.4 ? { aliases: [pick(aliases)] } : {}),
		};
		const multiple = random() < 0.3 ? { multiple: true as const } : {};
		flags[pick(names)] =
			random() < 0.5
				? {
						type: "boolean",
						...shared,
						...multiple,
						...(random() < 0.3 ? { noNegate: true as const } : {}),
					}
				: { type: "string", ...shared, ...multiple };
	}
	return flags;
}

function generateArgv(random: () => number, flags: FlagsDef): string[] {
	const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
	const longs = [...Object.keys(flags), ...Object.values(flags).flatMap((d) => d.aliases ?? [])];
	// Shorts include long spellings of one character, unknown `z`, and a stray `=`.
	const shorts = [...longs.filter((s) => s.length === 1), ...SHORTS, "z", "="];
	const long = () => pick([...longs, "zz", ...SHORTS]);
	const cluster = () =>
		Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(shorts)).join("");
	const tokens = [
		() => `--${long()}`,
		() => `--${long()}=${pick(VALUES)}`,
		() => `--no-${long()}`,
		() => `--no-${long()}=${pick(VALUES)}`,
		() => `-${cluster()}`,
		// Inline values for value-taking shorts; a leading `-` would hit the cluster difference above.
		() => `-${cluster()}${pick(VALUES.filter((value) => !value.startsWith("-")))}`,
		() => "--",
		() => pick(VALUES),
		() => "p",
	];
	return Array.from({ length: Math.floor(random() * 6) }, () => pick(tokens)());
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("argv tokenizer vs node:util.parseArgs", () => {
	const flags: FlagsDef = {
		verbose: { type: "boolean", short: "v", aliases: ["loud"] },
		name: { type: "string", short: "n", aliases: ["label"], multiple: true },
		count: { type: "string", short: "c" },
		quiet: { type: "boolean", noNegate: true, aliases: ["silent"] },
		q: { type: "boolean", multiple: true },
	};

	it.each([
		[],
		["-"],
		["--"],
		["--", "--verbose", "-z"],
		["a", "--", "b", "--"],
		["-vn", "x"],
		["-nv"],
		["-vqc3", "p"],
		["-vqc", "3"],
		["-n", "-"],
		["-n", "--"],
		["-n", "-x"],
		["-n-x"],
		["--name=-x"],
		["--name", "a", "--label=b", "-nc", "--name", "d"],
		["--verbose", "--no-loud", "--verbose"],
		["--verbose=1"],
		["--no-verbose=1"],
		["--no-quiet"],
		["--no-silent=1"],
		["-q", "--no-q", "-q"],
		["--unknown", "--no-quiet"],
		["--no-quiet", "--unknown"],
		["--name", "--no-quiet"],
		["--no-v"],
		["--no-name"],
		["--no-"],
		["--v"],
		["-z=x"],
		["-zx"],
		["-vz"],
		["-v=1"],
		["--=x"],
		["---x"],
		["--zz=1"],
		["--count"],
		["-c"],
	])("matches on %j", (...argv) => {
		expect(crustOutcome(flags, argv)).toEqual(oracleOutcome(flags, argv));
	});

	it("rejects `-` inside a cluster instead of reading it as `--`", () => {
		expect(crustOutcome(flags, ["-v-", "x"])).toEqual({
			error: 'Unknown flag "-v-"',
			details: { flag: "-", reason: "unknown-flag" },
		});
		expect(oracleOutcome(flags, ["-v-", "x"])).toMatchObject({ operands: ["x"] });
	});

	it("matches on seeded random flag specs and argv", () => {
		const random = seeded(0x5eed);
		for (let run = 0; run < 3000; run++) {
			const spec = generateFlags(random);
			const argv = generateArgv(random, spec);
			expect(crustOutcome(spec, argv), JSON.stringify({ spec, argv })).toEqual(
				oracleOutcome(spec, argv),
			);
		}
	});
});
