import { resolve } from "node:path";

import type { StandardSchema } from "@crustjs/utils/schema";
import { describe, expect, it } from "vite-plus/test";

import { makeNode, unwrap } from "../../tests/helpers.ts";
import { Crust } from "../command/crust.ts";
import { createCommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";
import { parseArgs, parseFlagValues, parseStructured, validateParsed } from "./parser.ts";

/** Surface a deferred value error the way the invocation's terminal step does. */
function parseAndValidate(...[command, argv, env]: Parameters<typeof parseArgs>): void {
	validateParsed(command, parseArgs(command, argv, env));
}

it("leaves required variadics empty until required validation", () => {
	const command = {
		...createCommandNode("raw"),
		args: [{ name: "files", type: "string", required: true, variadic: true }] as const,
	};
	const parsed = parseArgs(command, []);
	expect(parsed.args.files).toEqual([]);
	expect(() => validateParsed(command, parsed)).toThrow('Missing required argument "<files>"');
});

// ────────────────────────────────────────────────────────────────────────────
// Number flags with coercion
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — number flags", () => {
	it("rejects blank values from argv and env instead of coercing them to 0", () => {
		const envCmd = makeNode({
			meta: "test",
			flags: { port: { type: "number", default: 3000, env: "PORT" } },
		});
		for (const raw of ["", "  "]) {
			const message = "Expected a number for --port.";
			expect(() => parseAndValidate(envCmd, ["--port", raw], {})).toThrow(message);
			expect(() => parseAndValidate(envCmd, [`--port=${raw}`], {})).toThrow(message);
			expect(() => parseAndValidate(envCmd, [], { PORT: raw })).toThrow(
				"Expected a number for --port (from $PORT).",
			);
		}
	});

	it("defers a value error to validateParsed and leaves the flag unset, not defaulted", () => {
		const deferred = makeNode({
			meta: "test",
			flags: {
				port: { type: "number", default: 3000 },
				token: { type: "string", required: true },
			},
		});
		const parsed = parseArgs(deferred, ["--port", "abc"], {});
		expect(parsed.flags.port).toBeUndefined();
		expect(parsed.valueErrors?.get("--port")).toMatchObject({
			code: "PARSE",
			message: "Expected a number for --port.",
		});
		// A value error outranks missing-required, as when it was thrown during parsing.
		expect(() => validateParsed(deferred, parsed)).toThrow(parsed.valueErrors?.get("--port"));
		expect(parseArgs(deferred, ["--port", "80"], {})).not.toHaveProperty("valueErrors");
	});

	it("reads a number only as a finite decimal", () => {
		const cmd = makeNode({ meta: "test", flags: { ratio: { type: "number" } } });
		for (const [raw, value] of [
			["-1.5", -1.5],
			["2e3", 2000],
			[".5", 0.5],
			["7.", 7],
		] as const) {
			expect(parseArgs(cmd, [`--ratio=${raw}`]).flags.ratio).toBe(value);
		}
		for (const raw of ["0x10", "Infinity", "-Infinity", "NaN", " 7 ", "1e999", "1_000", "+1"]) {
			expect(() => parseAndValidate(cmd, [`--ratio=${raw}`], {})).toThrow(
				"Expected a number for --ratio.",
			);
		}
	});

	it("reads an integer as digits with an optional leading minus", () => {
		const cmd = makeNode({
			meta: "test",
			args: [{ name: "count", type: "integer" }],
			flags: { port: { type: "integer", env: "PORT" } },
		});
		expect(parseArgs(cmd, ["--port=-42", "--", "007"]).flags.port).toBe(-42);
		expect(parseArgs(cmd, ["--", "007"]).args.count).toBe(7);
		for (const raw of ["1.5", "1e3", "+1", "0x10", "", "99999999999999999999"]) {
			expect(() => parseAndValidate(cmd, [`--port=${raw}`], {})).toThrow(
				"Expected an integer for --port.",
			);
		}
		expect(() => parseAndValidate(cmd, ["x"], {})).toThrow("Expected an integer for <count>.");
		expect(() => validateParsed(cmd, parseStructured(cmd, { flags: { port: 1.5 } }))).toThrow(
			"Expected an integer for --port.",
		);
	});

	it("checks min and max on every source, but not on the default", () => {
		const cmd = makeNode({
			meta: "test",
			args: [{ name: "share", type: "number", min: 0, max: 1 }],
			flags: {
				port: { type: "integer", min: 1, max: 65535, env: "PORT" },
				jobs: { type: "integer", min: 1, default: 0 },
				limit: { type: "number", max: 10 },
			},
		});
		expect(parseArgs(cmd, ["--port", "1", "0.5"]).flags.port).toBe(1);
		expect(parseArgs(cmd, []).flags.jobs).toBe(0);
		for (const [argv, env, message] of [
			[["--port=0"], {}, "Expected an integer from 1 to 65535 for --port."],
			[["--port=65536"], {}, "Expected an integer from 1 to 65535 for --port."],
			[[], { PORT: "0" }, "Expected an integer from 1 to 65535 for --port (from $PORT)."],
			[["--jobs=0"], {}, "Expected an integer of at least 1 for --jobs."],
			[["--limit=10.5"], {}, "Expected a number of at most 10 for --limit."],
			[["2"], {}, "Expected a number from 0 to 1 for <share>."],
		] as const) {
			expect(() => parseAndValidate(cmd, [...argv], env)).toThrow(message);
		}
		expect(() => parseStructured(cmd, { flags: { port: 0 } })).toThrow(
			"Expected an integer from 1 to 65535 for --port.",
		);
		expect(() => parseStructured(cmd, { args: { share: Infinity } })).toThrow(
			"Expected a number for <share>.",
		);
	});
});

describe("parseArgs — count flags", () => {
	const cmd = makeNode({
		meta: "test",
		flags: {
			verbose: { type: "count", short: "v", aliases: ["loud"] },
			quiet: { type: "boolean", short: "q" },
		},
	});

	it("counts every occurrence, through any spelling, and is 0 when absent", () => {
		expect(parseArgs(cmd, ["-vvv"]).flags.verbose).toBe(3);
		expect(parseArgs(cmd, ["-vqv", "--verbose", "--loud"]).flags).toMatchObject({
			verbose: 4,
			quiet: true,
		});
		const absent = parseArgs(cmd, []);
		expect(absent.flags.verbose).toBe(0);
		expect(absent.sources.flags).not.toHaveProperty("verbose");
		expect(absent.flagOrder).toEqual([]);
	});

	it("takes no value and has no negation", () => {
		expect(() => parseArgs(cmd, ["--verbose=2"])).toThrow(
			'Flag "--verbose" does not take a value; write --verbose, or leave it out',
		);
		expect(() => parseArgs(cmd, ["--no-verbose"])).toThrow('Unknown flag "--no-verbose"');
		expect(parseArgs(cmd, ["-v", "x"]).excessArgs).toEqual(["x"]);
	});

	it("takes a non-negative integer from typed input", () => {
		expect(parseStructured(cmd, { flags: { verbose: 2 } }).flags.verbose).toBe(2);
		for (const value of [-1, 1.5, true]) {
			expect(() => parseStructured(cmd, { flags: { verbose: value } })).toThrow(
				"Expected a count for --verbose.",
			);
		}
	});
});

describe("parseArgs — booleans", () => {
	it("refuses =value with a hint, and accepts --no-x only for default: true or negatable", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				rm: { type: "boolean" },
				trunc: { type: "boolean", default: true },
				color: { type: "boolean", negatable: true, aliases: ["colour"] },
			},
		});
		expect(() => parseArgs(cmd, ["--rm=false"])).toThrow(
			'Flag "--rm" does not take a value; write --rm, or leave it out',
		);
		expect(() => parseArgs(cmd, ["--color=false"])).toThrow(
			'Flag "--color" does not take a value; write --color or --no-color',
		);
		expect(() => parseArgs(cmd, ["--no-colour=1"])).toThrow(
			'Flag "--color" does not take a value; write --color or --no-color',
		);
		expect(() => parseArgs(cmd, ["--no-rm"])).toThrow(
			'Flag "--rm" does not support negation ("--no-rm")',
		);
		expect(parseArgs(cmd, ["--no-trunc", "--no-colour"]).flags).toEqual({
			rm: undefined,
			trunc: false,
			color: false,
		});
		// A false value from typed input needs no negation.
		expect(parseStructured(cmd, { flags: { rm: false } }).flags.rm).toBe(false);
	});

	it("reads a positional boolean with the environment's words", () => {
		const cmd = makeNode({ meta: "test", args: [{ name: "on", type: "boolean" }] });
		expect(parseArgs(cmd, ["Yes"]).args.on).toBe(true);
		expect(parseArgs(cmd, ["off"]).args.on).toBe(false);
		expect(() => parseAndValidate(cmd, ["maybe"], {})).toThrow(
			"Expected a boolean (true, false, 1, 0, yes, no, on, off) for <on>.",
		);
	});
});

describe("parseArgs — values that start with a dash or `=`", () => {
	const cmd = makeNode({
		meta: "test",
		flags: {
			lines: { type: "integer", short: "n" },
			scale: { type: "number" },
			pattern: { type: "string", short: "e" },
			template: { type: "string", short: "t", choices: ["vue", "react"] },
			delimiter: { type: "string", short: "d" },
			dry: { type: "boolean", short: "D" },
		},
	});

	it("takes a negative number as the next word only for a numeric flag", () => {
		expect(parseArgs(cmd, ["-n", "-5", "--scale", "-1.5e2"]).flags).toMatchObject({
			lines: -5,
			scale: -150,
		});
		expect(() => parseArgs(cmd, ["-e", "-5"])).toThrow(
			'Missing value for flag "--pattern"; to pass a value starting with "-", write --pattern=<value>',
		);
		expect(() => parseArgs(cmd, ["-n", "-x"])).toThrow('Missing value for flag "--lines"');
		expect(parseArgs(cmd, ["-e=-5"]).flags.pattern).toBe("=-5");
	});

	it("keeps the `=` of an attached short value, and hints when the value is rejected", () => {
		expect(parseArgs(cmd, ["-d=", "-t", "vue"]).flags).toMatchObject({
			delimiter: "=",
			template: "vue",
		});
		expect(() => parseAndValidate(cmd, ["-t=vue"])).toThrow(
			"Invalid value for --template. Expected one of: vue, react. Write -t vue or --template=vue.",
		);
		expect(() => parseAndValidate(cmd, ["--lines==3"])).toThrow(
			"Expected an integer for --lines. Write -n 3 or --lines=3.",
		);
		// Nothing after the `=` is nothing to suggest.
		expect(() => parseAndValidate(cmd, ["-t="])).toThrow(
			/^Invalid value for --template\. Expected one of: vue, react$/,
		);
	});

	it("names a boolean short given `=value`", () => {
		expect(() => parseArgs(cmd, ["-D=1"])).toThrow('Flag "-D" does not take a value.');
		expect(() => parseArgs(cmd, ["-D=1"])).toThrow(
			expect.objectContaining({ details: { flag: "dry", reason: "unexpected-value" } }),
		);
	});
});

describe("parseArgs — exclusive groups", () => {
	const flags = {
		scope: {
			type: "exclusive",
			required: true,
			flags: {
				"org-id": { type: "string", short: "o", env: "ORG_ID" },
				"project-id": { type: "integer", env: "PROJECT_ID" },
				all: { type: "boolean", aliases: ["everything"], env: "ALL" },
			},
		},
	} as const;
	const cmd = makeNode({ meta: "test", flags });

	it("binds the member given as { flag, value }, or { flag } for a boolean", () => {
		expect(parseArgs(cmd, ["-o", "acme"], {}).flags.scope).toEqual({
			flag: "org-id",
			value: "acme",
		});
		expect(parseArgs(cmd, ["--project-id", "7"], {}).flags.scope).toEqual({
			flag: "project-id",
			value: 7,
		});
		const parsed = parseArgs(cmd, ["--everything"], {});
		expect(parsed.flags.scope).toEqual({ flag: "all" });
		expect(parsed.sources.flags).toEqual({ scope: "argv" });
		expect(parsed.flagOrder).toEqual(["scope"]);
		// The member's own spellings only: the group's name is no flag.
		expect(() => parseArgs(cmd, ["--scope", "x"], {})).toThrow('Unknown flag "--scope"');
	});

	it("refuses two members, or none when required, as usage errors", () => {
		expect(() => parseAndValidate(cmd, ["--all", "-o", "acme"], {})).toThrow(
			'Flags "--all" and "--org-id" cannot be used together',
		);
		expect(() => parseAndValidate(cmd, [], {})).toThrow(
			'Missing one of the required flags "--org-id", "--project-id", "--all"',
		);
		// The same member twice is one flag given twice: the last value wins.
		expect(parseArgs(cmd, ["-o", "a", "-o", "b"], {}).flags.scope).toEqual({
			flag: "org-id",
			value: "b",
		});
		const optional = makeNode({
			meta: "test",
			flags: { scope: { ...flags.scope, required: undefined } },
		});
		expect(parseArgs(optional, [], {}).flags.scope).toBeUndefined();
	});

	it("compares sources level by level: the command line, then the environment", () => {
		const both = { ORG_ID: "acme", PROJECT_ID: "7" };
		const fromArgv = parseArgs(cmd, ["--all"], both);
		expect(fromArgv.flags.scope).toEqual({ flag: "all" });
		expect(() => parseAndValidate(cmd, [], both)).toThrow(
			'Flags "--org-id" (from $ORG_ID) and "--project-id" (from $PROJECT_ID) cannot be used together',
		);
		const fromEnv = parseArgs(cmd, [], { PROJECT_ID: "7", ALL: "false" });
		expect(fromEnv.flags.scope).toEqual({ flag: "project-id", value: 7 });
		expect(fromEnv.sources.flags).toEqual({ scope: "env" });
		expect(() => parseAndValidate(cmd, [], { PROJECT_ID: "x" })).toThrow(
			"Expected an integer for --project-id (from $PROJECT_ID).",
		);
	});

	it("takes typed input in the shape the action receives", () => {
		expect(
			parseStructured(cmd, { flags: { scope: { flag: "org-id", value: "acme" } } }).flags.scope,
		).toEqual({ flag: "org-id", value: "acme" });
		expect(parseStructured(cmd, { flags: { scope: { flag: "all" } } }).flags.scope).toEqual({
			flag: "all",
		});
		expect(() => parseStructured(cmd, { flags: { scope: { flag: "team", value: "x" } } })).toThrow(
			"Expected { flag, value } for --scope, with flag one of: org-id, project-id, all",
		);
		expect(() => parseStructured(cmd, { flags: { scope: { flag: "all", value: true } } })).toThrow(
			'Expected { flag: "all" } for --scope',
		);
		expect(() => parseStructured(cmd, { flags: { scope: { flag: "project-id" } } })).toThrow(
			'Expected { flag: "project-id", value } for --scope',
		);
		// A second member's key is refused, not ignored.
		expect(() =>
			parseStructured(cmd, { flags: { scope: { flag: "org-id", value: "acme", all: true } } }),
		).toThrow('Expected { flag: "org-id", value } for --scope');
		expect(() =>
			parseStructured(cmd, { flags: { scope: { flag: "project-id", value: 1.5 } } }),
		).toThrow("Expected an integer for --project-id.");
		// An omitted group falls back to the environment.
		expect(parseStructured(cmd, {}, { ORG_ID: "acme" }).flags.scope).toEqual({
			flag: "org-id",
			value: "acme",
		});
	});

	it("names only listed members in its errors, and one alone without 'one of'", () => {
		const scope = {
			type: "exclusive",
			flags: { all: { type: "boolean" }, legacy: { type: "boolean", hidden: true } },
		} as const;
		const hiddenMember = makeNode({
			meta: "test",
			flags: { jq: { type: "string", requires: ["scope"] }, scope },
		});
		expect(() => parseAndValidate(hiddenMember, ["--jq", "."], {})).toThrow(
			'Flag "--jq" requires "--all"',
		);
		expect(() =>
			parseStructured(hiddenMember, { flags: { scope: { flag: "team", value: "x" } } }),
		).toThrow("Expected { flag, value } for --scope, with flag one of: all");
		const required = makeNode({ meta: "test", flags: { scope: { ...scope, required: true } } });
		expect(() => parseAndValidate(required, [], {})).toThrow('Missing required flag "--all"');
	});
});

describe("validateParsed — requires", () => {
	const cmd = makeNode({
		meta: "test",
		flags: {
			jq: { type: "string", requires: ["json"] },
			json: { type: "boolean", env: "JSON" },
			web: { type: "boolean", requires: ["scope"] },
			region: { type: "string", default: "us", requires: ["json"] },
			scope: { type: "exclusive", flags: { all: { type: "boolean" }, mine: { type: "boolean" } } },
			payload: { type: "json", requires: ["json"] },
			filter: { type: "string", requires: ["payload"] },
		},
	});

	it("needs the named flags from any source but a default, and not a boolean's false", () => {
		expect(() => parseAndValidate(cmd, ["--jq", "."], {})).toThrow('Flag "--jq" requires "--json"');
		expect(() => parseAndValidate(cmd, ["--jq", "."], { JSON: "false" })).toThrow(
			'Flag "--jq" requires "--json"',
		);
		expect(() => parseAndValidate(cmd, ["--web"], {})).toThrow(
			'Flag "--web" requires one of "--all", "--mine"',
		);
		parseAndValidate(cmd, ["--jq", ".", "--json"], {});
		parseAndValidate(cmd, ["--jq", "."], { JSON: "1" });
		parseAndValidate(cmd, ["--web", "--mine"], {});
		// A default is not given: `region` needs nothing until it is set.
		parseAndValidate(cmd, [], {});
		expect(() => parseAndValidate(cmd, ["--region", "eu"], {})).toThrow(
			'Flag "--region" requires "--json"',
		);
		expect(() => validateParsed(cmd, parseStructured(cmd, { flags: { jq: "." } }, {}))).toThrow(
			'Flag "--jq" requires "--json"',
		);
		// Only a boolean's false is "not given": a json flag's false is a value.
		expect(() => parseAndValidate(cmd, ["--payload", "false"], {})).toThrow(
			'Flag "--payload" requires "--json"',
		);
		parseAndValidate(cmd, ["--filter", "x", "--payload", "false", "--json"], {});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Aliases (short and long)
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — aliases", () => {
	it("accepts --<spelling> only for canonical and alias spellings", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				verbose: { type: "boolean", short: "v" },
				output: { type: "string", aliases: ["out"] },
				port: { type: "number", short: "p", aliases: ["P", "listen"] },
				tag: { type: "string", multiple: true, short: "t", aliases: ["label"] },
				color: { type: "boolean", aliases: ["colour"], negatable: true },
				strict: { type: "boolean", short: "s" },
			},
		});

		// A short spelling is reachable only as `-<short>`.
		expect(() => parseArgs(cmd, ["--v"])).toThrow('Unknown flag "--v"');
		expect(() => parseArgs(cmd, ["--s"])).toThrow('Unknown flag "--s"');
		expect(parseArgs(cmd, ["--P", "1"]).flags.port).toBe(1);

		expect(
			parseArgs(cmd, ["-vs", "-p8080", "-t", "a", "--label=b", "--no-colour"]).flags,
		).toMatchObject({
			verbose: true,
			strict: true,
			port: 8080,
			tag: ["a", "b"],
			color: false,
		});
		expect(parseArgs(cmd, ["-P", "9090", "--listen=7070", "--out", "x"]).flags).toMatchObject({
			port: 7070,
			output: "x",
		});
	});

	// One code point is one character to the types; clusters must not split its surrogate pair.
	it("accepts an astral short and reads clusters by code point", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				smile: { type: "boolean", short: "😀" },
				name: { type: "string", short: "n" },
			},
		});
		expect(parseArgs(cmd, ["-😀"]).flags.smile).toBe(true);
		expect(parseArgs(cmd, ["-😀n", "x"]).flags).toMatchObject({ smile: true, name: "x" });
		expect(parseArgs(cmd, ["-n😀"]).flags.name).toBe("😀");
		expect(() => parseArgs(cmd, ["-😁"])).toThrow(
			expect.objectContaining({
				message: 'Unknown flag "-😁"',
				details: { flag: "😁", reason: "unknown-flag" },
			}),
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Variadic positional args
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — variadic args", () => {
	it("omitted variadic resolves its default as one element on both front doors", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "files", type: "string", variadic: true, default: "fallback" }],
		});
		expect(parseArgs(cmd, []).args.files).toEqual(["fallback"]);
		expect(parseArgs(cmd, ["a", "b"]).args.files).toEqual(["a", "b"]);
		expect(parseStructured(cmd, {}).args.files).toEqual(["fallback"]);
		// An empty occurrence array is omission, matching `multiple` flags.
		expect(parseStructured(cmd, { args: { files: [] } }).args.files).toEqual(["fallback"]);
		expect(parseStructured(cmd, { args: { files: ["a"] } }).args.files).toEqual(["a"]);
	});

	it("omitted variadic defaults run through parse, path, falsey, and required rules", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [
				{ name: "a", type: "number", default: 1 },
				{
					name: "ids",
					type: "string",
					variadic: true,
					required: true,
					default: "7",
					parse: Number,
				},
			],
		});
		const parsed = parseArgs(cmd, []);
		expect(parsed.args).toEqual({ a: 1, ids: [7] });
		expect(() => validateParsed(cmd, parsed)).not.toThrow();

		const falsey = makeNode({
			meta: { name: "test" },
			args: [{ name: "n", type: "number", variadic: true, default: 0 }],
		});
		expect(parseArgs(falsey, []).args.n).toEqual([0]);

		const paths = makeNode({
			meta: { name: "test" },
			args: [{ name: "files", type: "path", variadic: true, default: "./dist" }],
		});
		expect(parseArgs(paths, []).args.files).toEqual([resolve("./dist")]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// '--' separator handling
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — '--' separator", () => {
	it("fills the remaining positionals after the ones before --, and rejects a word none takes", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [
				{ name: "name", type: "string", required: true },
				{ name: "offset", type: "number" },
			],
		});
		const result = parseArgs(cmd, ["a", "--", "-5", "rest"]);
		expect(result.args).toEqual({ name: "a", offset: -5 });
		expect(result.excessArgs).toEqual(["rest"]);
		expect(() => validateParsed(cmd, result)).toThrow(
			new CrustError("VALIDATION", 'Unexpected positional argument: "rest"'),
		);
	});

	it("lets a variadic positional consume every token after --", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "files", type: "string", variadic: true, required: true }],
		});
		const result = parseArgs(cmd, ["a", "--", "-b", "--", "c"]);
		expect(result.args.files).toEqual(["a", "-b", "--", "c"]);
		expect(result.excessArgs).toEqual([]);
	});

	it("treats flag spellings after -- as values", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "pattern", type: "string", required: true }],
			flags: { verbose: { type: "boolean" } },
		});
		const result = parseArgs(cmd, ["--", "--verbose", "--help"]);
		expect(result.args.pattern).toBe("--verbose");
		expect(result.flags.verbose).toBeUndefined();
		expect(result.excessArgs).toEqual(["--help"]);
	});

	it("reports excess positionals on both sides of -- once every declared one is filled", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "file", type: "string" }],
		});
		const result = parseArgs(cmd, ["a", "b", "--", "c"]);
		expect(result.args.file).toBe("a");
		expect(result.excessArgs).toEqual(["b", "c"]);
		// A command without arguments takes nothing after `--` either.
		const bare = makeNode({ meta: { name: "ps" } });
		expect(() => validateParsed(bare, parseArgs(bare, ["--", "anything"]))).toThrow(
			'Unexpected positional argument: "anything"',
		);
	});
});

describe('parseArgs — variadic: "afterDoubleDash"', () => {
	const run = makeNode({
		meta: { name: "run" },
		args: [
			{ name: "task", type: "string", required: true },
			{ name: "pkgs", type: "string", variadic: true },
			{ name: "extra", type: "string", variadic: "afterDoubleDash" },
		],
		flags: { watch: { type: "boolean" } },
	});

	it("stops the variadic before it at -- and takes every token after", () => {
		const result = parseArgs(run, ["build", "core", "cli", "--watch", "--", "--watch", "-5", "--"]);
		expect(result.args).toEqual({
			task: "build",
			pkgs: ["core", "cli"],
			extra: ["--watch", "-5", "--"],
		});
		expect(result.flags.watch).toBe(true);
		expect(result.excessArgs).toEqual([]);
		expect(result.sources.args).toEqual({ task: "argv", pkgs: "argv", extra: "argv" });
	});

	it("never fills earlier positionals from tokens after --", () => {
		const result = parseArgs(run, ["--", "build"]);
		expect(result.args).toEqual({ task: undefined, pkgs: [], extra: ["build"] });
		expect(() => validateParsed(run, result)).toThrow(/^Missing required argument "<task>"$/);
		expect(parseArgs(run, ["build"]).args).toEqual({ task: "build", pkgs: [], extra: [] });
	});

	it("reports a required one given before -- as missing, with a hint", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "script", type: "string", required: true, variadic: "afterDoubleDash" }],
		});
		const result = parseArgs(cmd, ["build"]);
		expect(result.excessArgs).toEqual(["build"]);
		expect(() => validateParsed(cmd, { ...result, excessArgs: [] })).toThrow(
			'Missing required argument "<script>" (pass it after "--")',
		);
		expect(parseArgs(cmd, ["--", "build"]).args).toEqual({ script: ["build"] });
	});

	it("binds structured input by name, even with an earlier argument omitted", () => {
		const result = parseStructured(run, { args: { task: "build", extra: ["--watch"] } });
		expect(result.args).toEqual({ task: "build", pkgs: [], extra: ["--watch"] });
		expect(result.sources.args).toEqual({ task: "run", extra: "run" });
	});
});

describe('parseArgs — variadic: "passthrough"', () => {
	const run = makeNode({
		meta: { name: "run" },
		args: [
			{ name: "image", type: "string", required: true },
			{ name: "command", type: "string", variadic: "passthrough" },
		],
		flags: { rm: { type: "boolean" }, name: { type: "string" } },
	});

	it("reads flags only before the first positional and keeps every later word as typed", () => {
		expect(parseArgs(run, ["--rm", "alpine", "ls", "-la", "--color"])).toMatchObject({
			args: { image: "alpine", command: ["ls", "-la", "--color"] },
			flags: { rm: true },
			excessArgs: [],
		});
		// A flag value is not the first positional; a later declared flag spelling is the child's.
		expect(parseArgs(run, ["--name", "run", "alpine", "echo", "--rm"])).toMatchObject({
			args: { image: "alpine", command: ["echo", "--rm"] },
			flags: { name: "run", rm: undefined },
		});
	});

	it("keeps a -- after the first positional, and lets one before it end flags", () => {
		expect(parseArgs(run, ["alpine", "--", "x"]).args).toEqual({
			image: "alpine",
			command: ["--", "x"],
		});
		expect(parseArgs(run, ["--rm", "--", "--image", "-x"])).toMatchObject({
			args: { image: "--image", command: ["-x"] },
			flags: { rm: true },
		});
	});

	it("still rejects an unknown flag before the first positional", () => {
		expect(() => parseArgs(run, ["--bogus", "alpine"])).toThrow('Unknown flag "--bogus"');
	});

	it("starts at the first positional when it is the only argument", () => {
		const exec = makeNode({
			meta: { name: "exec" },
			args: [{ name: "argv", type: "string", variadic: "passthrough", required: true }],
			flags: { verbose: { type: "boolean", short: "v" } },
		});
		expect(parseArgs(exec, ["-v", "sh", "-c", "echo $HOME", "-v"])).toMatchObject({
			args: { argv: ["sh", "-c", "echo $HOME", "-v"] },
			flags: { verbose: true },
		});
		// `-` (stdin) is a positional, so it starts the passthrough too.
		expect(parseArgs(exec, ["-", "-v"]).args).toEqual({ argv: ["-", "-v"] });
	});

	it("keeps an argv tail longer than the call stack's argument limit", () => {
		const words = Array.from({ length: 150_000 }, () => "x");
		expect(parseArgs(run, ["alpine", ...words]).args.command).toHaveLength(150_000);
		const list = makeNode({
			meta: { name: "list" },
			args: [{ name: "files", type: "string", variadic: true }],
		});
		expect(parseArgs(list, ["--", ...words]).args.files).toHaveLength(150_000);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Complex/mixed scenarios
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — complex scenarios", () => {
	it("boolean arg coercion", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "force", type: "boolean" }],
		});
		const result = parseArgs(cmd, ["true"]);
		expect(result.args.force).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// validateParsed
// ────────────────────────────────────────────────────────────────────────────

describe("validateParsed", () => {
	it("rejects positionals not consumed by declared arguments", () => {
		const cmd = makeNode({ meta: { name: "gyst" }, run: () => {} });
		const parsed = parseArgs(cmd, ["sesion", "status"]);

		expect(parsed.excessArgs).toEqual(["sesion", "status"]);
		expect(() => validateParsed(cmd, parsed)).toThrow(
			'Unexpected positional arguments: "sesion", "status"',
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// parse escape hatch
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — parse escape hatch", () => {
	it("runs parse per element on multi-value flags", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				nums: { type: "string", multiple: true, parse: (s) => Number(s) },
			},
		});
		const result = parseArgs(cmd, ["--nums", "1", "--nums", "2"]);
		expect(result.flags.nums).toEqual([1, 2]);
	});

	it("wraps parse errors as CrustError(PARSE) with the flag name", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				n: {
					type: "string",
					parse: () => {
						throw new Error("custom failure");
					},
				},
			},
		});
		expect(() => parseAndValidate(cmd, ["--n", "x"])).toThrow(
			expect.objectContaining({ code: "PARSE", message: "Failed to parse --n: custom failure" }),
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// choices enforcement
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — choices enforcement", () => {
	it("validates choices on raw argv before parse runs (order test)", () => {
		let parseCalled = false;
		const cmd = makeNode({
			meta: "test",
			flags: {
				n: {
					type: "string",
					choices: ["1", "2"] as const,
					parse: (s) => {
						parseCalled = true;
						return Number(s);
					},
				},
			},
		});
		expect(() => parseAndValidate(cmd, ["--n", "3"])).toThrow(CrustError);
		expect(parseCalled).toBe(false);
	});

	it("validates each element of multi-value choices independently", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				tags: {
					type: "string",
					multiple: true,
					choices: ["a", "b", "c"] as const,
				},
			},
		});
		const ok = parseArgs(cmd, ["--tags", "a", "--tags", "b"]);
		expect(ok.flags.tags).toEqual(["a", "b"]);
		expect(() => parseAndValidate(cmd, ["--tags", "a", "--tags", "z"])).toThrow(CrustError);
	});
});

// ───────────────────────────────────────────────────────────────────────────
// Default coercion symmetry
//
// Argv-supplied values flow through choices → parse | coerce. The default
// branch must mirror both so omitted-flag behavior is not silently weaker
// (path defaults left relative, config-driven defaults outside `choices`
// accepted, etc.). Literal defaults are also branded (FIX_DEFAULT_CHOICE);
// the runtime check is the single home for the widened/dynamic path.
// ───────────────────────────────────────────────────────────────────────────

describe("parseArgs \u2014 default coercion symmetry", () => {
	it("runs coercePath per element on a multi `type: path` flag default", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				dirs: { type: "path", multiple: true, default: ["./a", "./b"] },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.dirs).toEqual([`${process.cwd()}/a`, `${process.cwd()}/b`]);
	});

	it("stringifies runtime-configured defaults before parsing", () => {
		let received: string | undefined;
		const cmd = makeNode({
			meta: "test",
			flags: {
				value: {
					type: "string",
					// SAFETY: Deliberately simulates runtime configuration that violates the static default contract.
					default: 42 as never,
					parse: (raw) => {
						received = raw;
						return raw;
					},
				},
			},
		});
		expect(parseArgs(cmd, []).flags.value).toBe("42");
		expect(received).toBe("42");
	});

	it("names the flag whose dynamic definition is invalid", () => {
		const short: string = "vv";
		expect(() => new Crust("test").flags({ verbose: { type: "boolean", short } })).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				message: 'Flag "verbose" short "vv" must be one character',
				details: { subject: "flag", name: "verbose", reason: "invalid-short" },
			}),
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Environment fallback (`env`) and occurrence splitting (`delimiter`)
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs \u2014 env fallback", () => {
	it("leaves an optional flag undefined when neither argv nor env supplies it", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { token: { type: "string", env: "APP_TOKEN" } },
		});
		expect(parseArgs(cmd, [], { OTHER: "x" }).flags.token).toBeUndefined();
		expect(parseArgs(cmd, [], { APP_TOKEN: undefined }).flags.token).toBeUndefined();
	});

	it("reads only own properties of argv values and the environment", () => {
		for (const name of ["constructor", "toString", "hasOwnProperty"]) {
			const cmd = makeNode({
				meta: "test",
				flags: {
					[name]: { type: "string", env: "APP_VALUE", default: "fallback" },
					tags: { type: "string", multiple: true, env: name, delimiter: "," },
				},
			});
			// An omitted prototype-named flag falls back to env, then default.
			expect(parseArgs(cmd, [], { APP_VALUE: "env-value" }).flags[name]).toBe("env-value");
			expect(parseArgs(cmd, [], {}).flags[name]).toBe("fallback");
			expect(parseArgs(cmd, [`--${name}`, "argv"], { APP_VALUE: "env-value" }).flags[name]).toBe(
				"argv",
			);
			// A prototype-named variable absent from the environment is absent.
			expect(parseArgs(cmd, [], {}).flags.tags).toBeUndefined();
			expect(parseArgs(cmd, [], { [name]: "a,b" }).flags.tags).toEqual(["a", "b"]);
		}
	});

	it("satisfies a required flag from env", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { token: { type: "string", env: "APP_TOKEN", required: true } },
		});
		const parsed = parseArgs(cmd, [], { APP_TOKEN: "secret" });
		expect(parsed.flags.token).toBe("secret");
		expect(() => validateParsed(cmd, parsed)).not.toThrow();
		expect(() => validateParsed(cmd, parseArgs(cmd, [], {}))).toThrow(
			'Missing required flag "--token"',
		);
	});

	it("runs env values through the same coercion, choices, and parse path as argv", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				port: { type: "number", env: "APP_PORT" },
				mode: { type: "string", env: "APP_MODE", choices: ["dev", "prod"] },
				level: { type: "string", env: "APP_LEVEL", parse: (raw) => raw.toUpperCase() },
				home: { type: "url", env: "APP_HOME" },
			},
		});
		const parsed = parseArgs(cmd, [], {
			APP_PORT: "8080",
			APP_MODE: "prod",
			APP_LEVEL: "info",
			APP_HOME: "https://example.com",
		});
		expect(parsed.flags.port).toBe(8080);
		expect(parsed.flags.mode).toBe("prod");
		expect(parsed.flags.level).toBe("INFO");
		expect(parsed.flags.home).toEqual(new URL("https://example.com"));

		expect(() => parseAndValidate(cmd, [], { APP_PORT: "nope" })).toThrow(
			"Expected a number for --port (from $APP_PORT).",
		);
		expect(() => parseAndValidate(cmd, [], { APP_MODE: "test" })).toThrow(
			"Invalid value for --mode (from $APP_MODE). Expected one of: dev, prod",
		);
	});

	it("passes env values to schema-backed flags as the raw token shape", () => {
		const schema = {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate: (value: unknown) => ({ value }),
			},
		};
		const cmd = makeNode({
			meta: "test",
			flags: {
				port: { type: "string", schema, env: "APP_PORT" },
				tags: { type: "string", schema, env: "APP_TAGS", delimiter: ",", multiple: true },
				body: { type: "json", schema, env: "APP_BODY" },
			},
		});
		const parsed = parseArgs(cmd, [], {
			APP_PORT: "8080",
			APP_TAGS: "a,b",
			APP_BODY: '{"name":"a"}',
		});
		expect(parsed.flags.port).toBe("8080");
		expect(parsed.flags.tags).toEqual(["a", "b"]);
		// A json flag's token is JSON text; its schema receives the parsed value.
		expect(parsed.flags.body).toEqual({ name: "a" });
	});

	it("reads boolean env values as true, 1, yes, on or false, 0, no, off in any case", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { color: { type: "boolean", env: "APP_COLOR", default: true } },
		});
		for (const [raw, expected] of [
			["true", true],
			["1", true],
			["YES", true],
			["On", true],
			["false", false],
			["0", false],
			["no", false],
			["OFF", false],
		] as const) {
			expect(parseArgs(cmd, [], { APP_COLOR: raw }).flags.color).toBe(expected);
		}
		expect(parseArgs(cmd, ["--no-color"], { APP_COLOR: "true" }).flags.color).toBe(false);
		expect(parseArgs(cmd, ["--color"], { APP_COLOR: "false" }).flags.color).toBe(true);
	});

	it("rejects any other boolean env text, naming the variable, not the value", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { color: { type: "boolean", env: "APP_COLOR" } },
		});
		expect(() => parseAndValidate(cmd, [], { APP_COLOR: "maybe" })).toThrow(
			"Expected a boolean (true, false, 1, 0, yes, no, on, off) for --color (from $APP_COLOR).",
		);
	});

	it("treats an empty boolean variable as unset", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { color: { type: "boolean", env: ["APP_COLOR", "COLOR"], default: true } },
		});
		const parsed = parseArgs(cmd, [], { APP_COLOR: "" });
		expect(parsed.flags.color).toBe(true);
		expect(parsed.sources.flags.color).toBe("default");
		expect(parseArgs(cmd, [], { APP_COLOR: "", COLOR: "off" }).flags.color).toBe(false);
	});

	it("accepts a false env value for a boolean that is not negatable", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { color: { type: "boolean", env: "APP_COLOR" } },
		});
		expect(parseArgs(cmd, [], { APP_COLOR: "1" }).flags.color).toBe(true);
		expect(parseArgs(cmd, [], { APP_COLOR: "0" }).flags.color).toBe(false);
	});

	it("reads the first variable of an env list that is set", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { registry: { type: "string", env: ["APP_REGISTRY", "npm_config_registry"] } },
		});
		const env = { npm_config_registry: "https://npm.example" };
		expect(parseArgs(cmd, [], env).flags.registry).toBe("https://npm.example");
		expect(parseArgs(cmd, [], { ...env, APP_REGISTRY: "https://app.example" }).flags.registry).toBe(
			"https://app.example",
		);
		// A set but empty string variable is a value; only booleans read it as unset.
		expect(parseArgs(cmd, [], { ...env, APP_REGISTRY: "" }).flags.registry).toBe("");
		expect(() =>
			parseAndValidate(
				makeNode({ meta: "test", flags: { port: { type: "integer", env: ["A", "B"] } } }),
				[],
				{
					B: "x",
				},
			),
		).toThrow("Expected an integer for --port (from $B).");
	});

	it("treats an explicit argv occurrence through an alias or negation as argv presence", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				output: { type: "string", short: "o", aliases: ["out"], env: "APP_OUTPUT" },
				loud: { type: "boolean", aliases: ["noisy"], env: "APP_LOUD", negatable: true },
			},
		});
		const env = { APP_OUTPUT: "from-env", APP_LOUD: "true" };
		expect(parseArgs(cmd, ["-o", "short"], env).flags.output).toBe("short");
		expect(parseArgs(cmd, ["--out", "alias"], env).flags.output).toBe("alias");
		expect(parseArgs(cmd, ["--output", ""], env).flags.output).toBe("");
		expect(parseArgs(cmd, ["--no-noisy"], env).flags.loud).toBe(false);
	});

	it("falls back to env for flags structured input omits", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				token: { type: "string", env: "TOKEN", required: true },
				port: { type: "number", env: "PORT", default: 1 },
				tags: { type: "string", multiple: true, env: "TAGS", delimiter: ":" },
			},
		});
		const env = { TOKEN: "s3cret", TAGS: "a:b" };
		const fromEnv = parseStructured(cmd, { flags: { token: undefined } }, env);
		expect(fromEnv.flags).toEqual({ token: "s3cret", port: 1, tags: ["a", "b"] });
		expect(fromEnv.sources.flags).toEqual({ token: "env", port: "default", tags: "env" });
		expect(fromEnv.flagOrder).toEqual(["tags", "token"]);
		// A supplied value wins, and its delimiters are not split.
		const supplied = parseStructured(cmd, { flags: { tags: ["a,b", "c"], token: "t" } }, env);
		expect(supplied.flags.tags).toEqual(["a,b", "c"]);
		expect(supplied.flags.token).toBe("t");
		expect(supplied.sources.flags.token).toBe("run");
		// An invalid environment value is deferred and names its variable, not its value.
		const invalid = parseStructured(cmd, {}, { PORT: "many" });
		expect(() => validateParsed(cmd, invalid)).toThrow(
			"Expected a number for --port (from $PORT).",
		);
		expect(parseStructured(cmd, {}, {}).flags.token).toBeUndefined();
	});

	it("reads process.env by default on the argv path", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { home: { type: "string", env: "HOME" } },
		});
		expect(parseArgs(cmd, [])).toEqual(parseArgs(cmd, [], process.env));
		expect(parseArgs(cmd, []).flags.home).toBe(process.env.HOME);
		expect(parseArgs(cmd, [], {}).flags.home).toBeUndefined();
	});
});

describe("parseArgs \u2014 delimiter", () => {
	it("splits argv values and env text with the flag's one delimiter", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { tags: { type: "string", multiple: true, delimiter: ",", env: "APP_TAGS" } },
		});
		expect(parseArgs(cmd, ["--tags=a,b:c"], { APP_TAGS: "ignored" }).flags.tags).toEqual([
			"a",
			"b:c",
		]);
		expect(parseArgs(cmd, [], { APP_TAGS: "a,b:c" }).flags.tags).toEqual(["a", "b:c"]);
		expect(parseStructured(cmd, { flags: { tags: ["a,b:c"] } }).flags.tags).toEqual(["a,b:c"]);
		const whole = makeNode({
			meta: "test",
			flags: { tags: { type: "string", multiple: true, env: "APP_TAGS" } },
		});
		expect(parseArgs(whole, [], { APP_TAGS: "a,b:c" }).flags.tags).toEqual(["a,b:c"]);
	});

	const cmd = makeNode({
		meta: "test",
		flags: {
			tags: { type: "string", multiple: true, env: "APP_TAGS", delimiter: ",", default: ["x"] },
			ports: { type: "number", multiple: true, env: "APP_PORTS", delimiter: ":" },
		},
	});

	it("splits argv occurrences in order and drops empty segments", () => {
		expect(parseArgs(cmd, ["--tags", "a,b", "--tags", ",c,,"], {}).flags.tags).toEqual([
			"a",
			"b",
			"c",
		]);
		expect(parseArgs(cmd, ["--ports", "80:443"], {}).flags.ports).toEqual([80, 443]);
	});

	it("splits env values and coerces every occurrence", () => {
		const parsed = parseArgs(cmd, [], { APP_TAGS: "a,,b", APP_PORTS: "80:443" });
		expect(parsed.flags.tags).toEqual(["a", "b"]);
		expect(parsed.flags.ports).toEqual([80, 443]);
		expect(() => parseAndValidate(cmd, [], { APP_PORTS: "80:nope" })).toThrow(
			"Expected a number for --ports (from $APP_PORTS).",
		);
	});

	it("keeps an explicit all-empty argv value as argv, never falling through to env", () => {
		// Zero occurrences after splitting then follow the existing empty-array rule (default).
		expect(parseArgs(cmd, ["--tags", ","], { APP_TAGS: "stale" }).flags.tags).toEqual(["x"]);
		expect(parseArgs(cmd, ["--ports", ":"], { APP_PORTS: "80" }).flags.ports).toBeUndefined();
		expect(parseArgs(cmd, [], { APP_TAGS: "," }).flags.tags).toEqual(["x"]);
	});

	it("splits boolean env text while keeping boolean argv switches and structured values intact", () => {
		const command = makeNode({
			meta: "test",
			flags: {
				enabled: {
					type: "boolean",
					multiple: true,
					negatable: true,
					env: "APP_ENABLED",
					delimiter: ",",
				},
			},
		});
		expect(parseArgs(command, [], { APP_ENABLED: "true,,false,1" }).flags.enabled).toEqual([
			true,
			false,
			true,
		]);
		expect(
			parseArgs(command, ["--enabled", "--no-enabled"], { APP_ENABLED: "false" }).flags.enabled,
		).toEqual([true, false]);
		expect(() => parseArgs(command, ["--enabled=true,false"], {})).toThrow(CrustError);
		expect(parseStructured(command, { flags: { enabled: [false, true] } }).flags.enabled).toEqual([
			false,
			true,
		]);
	});
});

describe("parseStructured", () => {
	it("treats inherited prototype names as omitted while accepting own values", () => {
		for (const name of ["constructor", "toString"]) {
			for (const required of [false, true]) {
				const def = {
					type: "string",
					required: required || undefined,
					default: required ? undefined : "fallback",
				} as const;
				for (const kind of ["args", "flags"] as const) {
					const command = makeNode({
						meta: "test",
						...(kind === "args" ? { args: [{ name, ...def }] } : { flags: { [name]: def } }),
					});
					for (const input of [{}, { [kind]: {} }]) {
						const result = parseStructured(command, input);
						expect(result[kind][name]).toBe(def.default);
						if (required) {
							expect(() => validateParsed(command, result)).toThrow(
								kind === "args"
									? `Missing required argument "<${name}>"`
									: `Missing required flag "--${name}"`,
							);
						}
					}
					const supplied = parseStructured(command, { [kind]: { [name]: "own" } });
					expect(supplied[kind][name]).toBe("own");
					expect(() => validateParsed(command, supplied)).not.toThrow();
				}
			}
		}
	});

	it("does not invoke inherited structured input getters", () => {
		class Input {
			readonly [name: string]: string;

			get value(): string {
				throw new Error("Inherited getter must not be read");
			}
		}
		const command = makeNode({
			meta: "test",
			args: [{ name: "value", type: "string", default: "argument" }],
			flags: { value: { type: "string", default: "flag" } },
		});
		expect(parseStructured(command, { args: new Input() }).args.value).toBe("argument");
		expect(parseStructured(command, { flags: new Input() }).flags.value).toBe("flag");
	});

	it.each(["args", "flags"] as const)("reads each own structured %s getter once", (kind) => {
		let reads = 0;
		const values = {
			get value() {
				if (++reads > 1) throw new Error("Structured value read twice");
				return "first";
			},
		};
		const command = makeNode({
			meta: "test",
			...(kind === "args"
				? { args: [{ name: "value", type: "string" }] }
				: { flags: { value: { type: "string" } } }),
		});
		expect(parseStructured(command, { [kind]: values })[kind].value).toBe("first");
		expect(reads).toBe(1);
	});

	it("passes numbers, booleans, and URL instances through", () => {
		const url = new URL("https://example.com");
		const command = makeNode({
			meta: "test",
			args: [
				{ name: "count", type: "number" },
				{ name: "enabled", type: "boolean" },
				{ name: "url", type: "url" },
			],
			flags: { count: { type: "number" }, enabled: { type: "boolean" }, url: { type: "url" } },
		});
		const values = { count: -3, enabled: false, url };
		const result = parseStructured(command, { args: values, flags: values });
		expect(result.args).toEqual(values);
		expect(result.flags).toEqual(values);
		expect(result.args.url).toBe(url);
		expect(result.flags.url).toBe(url);
	});

	it("resolves path arguments and multiple path flags", () => {
		const command = makeNode({
			meta: "test",
			args: [{ name: "out", type: "path" }],
			flags: { dirs: { type: "path", multiple: true } },
		});
		const result = parseStructured(command, {
			args: { out: "./dist" },
			flags: { dirs: ["./a", "./b"] },
		});
		expect(result.args.out).toBe(`${process.cwd()}/dist`);
		expect(result.flags.dirs).toEqual([`${process.cwd()}/a`, `${process.cwd()}/b`]);
	});

	it("validates choices before invoking parse on the supplied string", () => {
		const seen: string[] = [];
		const parse = (raw: string) => {
			seen.push(raw);
			return Number(raw);
		};
		const command = makeNode({
			meta: "test",
			args: [{ name: "port", type: "string", choices: ["80"], parse }],
			flags: { port: { type: "string", choices: ["80"], parse } },
		});
		expect(parseStructured(command, { args: { port: "80" }, flags: { port: "80" } })).toMatchObject(
			{ args: { port: 80 }, flags: { port: 80 } },
		);
		expect(seen).toEqual(["80", "80"]);
		expect(() => parseStructured(command, { flags: { port: "90" } })).toThrow(
			"Invalid value for --port. Expected one of: 80",
		);
		expect(() => parseStructured(command, { args: { port: "90" } })).toThrow(
			"Invalid value for <port>. Expected one of: 80",
		);
		expect(seen).toEqual(["80", "80"]);
	});

	it("preserves multiple flag order and rejects checked scalar occurrences", () => {
		const command = makeNode({ meta: "test", flags: { tag: { type: "string", multiple: true } } });
		expect(parseStructured(command, { flags: { tag: ["b", "-a"] } }).flags.tag).toEqual([
			"b",
			"-a",
		]);
		expect(() => parseStructured(command, { flags: { tag: "a" } })).toThrow(
			"Expected an occurrence array",
		);
	});

	it("spreads variadic values in definition order", async () => {
		const command = makeNode({
			meta: "test",
			args: [
				{ name: "first", type: "string" },
				{ name: "rest", type: "string", variadic: true },
			],
		});
		expect(parseStructured(command, { args: { rest: ["b", "a"], first: "-first" } }).args).toEqual({
			first: "-first",
			rest: ["b", "a"],
		});
		const app = new Crust("run").args(
			{ name: "first", type: "string" },
			{ name: "rest", type: "string", variadic: true },
		);
		await expect(
			unwrap(
				// @ts-expect-error -- runtime regression deliberately supplies a scalar variadic.
				app.run([], { args: { first: "a", rest: "b" } }),
			),
		).rejects.toThrow("occurrence array");
	});

	it("keeps scalar JSON arrays intact", () => {
		const command = makeNode({
			meta: "test",
			args: [{ name: "data", type: "json" }],
			flags: { data: { type: "json" } },
		});
		const data = [1, 2];
		const result = parseStructured(command, { args: { data }, flags: { data } });
		expect(result.args.data).toBe(data);
		expect(result.flags.data).toBe(data);
		expect(result.excessArgs).toEqual([]);
	});

	it("rejects gaps, unknown argument names, and unknown canonical flags", () => {
		const command = makeNode({
			meta: "test",
			args: [
				{ name: "first", type: "string" },
				{ name: "second", type: "string" },
			],
			flags: { mode: { type: "string", aliases: ["format"] } },
		});
		for (const [input, reason] of [
			[{ args: { second: "x" } }, "positional-gap"],
			[{ args: { bogus: "x" } }, "unknown-argument"],
			[{ flags: { bogus: "x" } }, "unknown-flag"],
			[{ flags: { format: "x" } }, "unknown-flag"],
			[{ flags: { constructor: "x" } }, "unknown-flag"],
		] as const) {
			expect(() => parseStructured(command, input)).toThrow(
				expect.objectContaining({ code: "PARSE", details: expect.objectContaining({ reason }) }),
			);
		}
	});

	it("resolves omitted defaults with the same transforms as argv", () => {
		const command = makeNode({
			meta: "test",
			args: [{ name: "port", type: "string", parse: Number, default: "80" }],
			flags: { dir: { type: "path", default: "./dist" } },
		});
		expect(
			parseStructured(command, { args: { port: undefined }, flags: { dir: undefined } }),
		).toEqual(parseArgs(command, []));
	});

	it("treats empty multiple arrays as zero occurrences for defaults and required flags", () => {
		const command = makeNode({
			meta: "test",
			flags: {
				optional: { type: "string", multiple: true },
				defaulted: { type: "string", multiple: true, default: ["fallback"] },
				required: { type: "string", multiple: true, required: true },
			},
		});
		const result = parseStructured(command, {
			flags: { optional: [], defaulted: [], required: [] },
		});
		expect(result).toEqual(parseArgs(command, []));
		expect(() => validateParsed(command, result)).toThrow('Missing required flag "--required"');
	});
});

describe("parseFlagValues", () => {
	it("runs env text through choices, parse, coercion, delimiter, and defaults", async () => {
		const flags = {
			port: { type: "number", env: "PORT" },
			level: { type: "string", choices: ["info", "debug"], env: "LEVEL" },
			upper: { type: "string", parse: (raw: string) => raw.toUpperCase(), env: "UP" },
			tags: { type: "string", multiple: true, env: "TAGS", delimiter: "," },
			on: { type: "boolean", env: "ON" },
			fallback: { type: "number", default: 7, env: "UNSET" },
		} as const;
		const env = { PORT: "8080", LEVEL: "debug", UP: "abc", TAGS: "a,,b", ON: "1" };
		await expect(parseFlagValues(flags, env)).resolves.toEqual({
			port: 8080,
			level: "debug",
			upper: "ABC",
			tags: ["a", "b"],
			on: true,
			fallback: 7,
		});
	});

	it("rejects coercion and requiredness failures", async () => {
		await expect(
			parseFlagValues({ port: { type: "number", env: "PORT" } }, { PORT: "x" }),
		).rejects.toMatchObject({ code: "PARSE" });
		await expect(
			parseFlagValues({ port: { type: "number", default: 1, env: "PORT" } }, { PORT: "" }),
		).rejects.toMatchObject({
			code: "PARSE",
			message: "Expected a number for --port (from $PORT).",
		});
		await expect(
			parseFlagValues({ key: { type: "string", required: true, env: "KEY" } }, {}),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("checks requires against the variables given", async () => {
		const flags = {
			query: { type: "string", env: "QUERY", requires: ["json"] },
			json: { type: "boolean", env: "JSON" },
		} as const;
		await expect(parseFlagValues(flags, { QUERY: "x" })).rejects.toMatchObject({
			code: "VALIDATION",
			message: 'Flag "--query" requires "--json"',
		});
		await expect(parseFlagValues(flags, { QUERY: "x", JSON: "1" })).resolves.toEqual({
			query: "x",
			json: true,
		});
	});

	it("rejects a definition core normalization rejects, such as a __proto__ key", async () => {
		const reserved = Object.defineProperty({}, "__proto__", {
			value: { type: "string", env: "X" },
			enumerable: true,
		});
		await expect(parseFlagValues(reserved, { X: "x" })).rejects.toMatchObject({
			code: "DEFINITION",
			details: { reason: "reserved-spelling" },
		});
	});

	it("awaits async schemas and ignores inherited variables", async () => {
		const upper: StandardSchema<string | undefined, string> = {
			"~standard": {
				version: 1,
				vendor: "crust-test",
				validate: async (value) => ({ value: String(value).toUpperCase() }),
			},
		};
		const flags = {
			name: { type: "string", schema: upper, env: "NAME" },
			inherited: { type: "string", env: "constructor" },
		} as const;
		await expect(parseFlagValues(flags, { NAME: "crust" })).resolves.toEqual({
			name: "CRUST",
			inherited: undefined,
		});
	});
});
