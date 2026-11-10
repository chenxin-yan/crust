import { resolve } from "node:path";

import type { StandardSchema } from "@crustjs/utils/schema";
import { describe, expect, it } from "vite-plus/test";

import { makeNode, unwrap } from "../../tests/helpers.ts";
import { Crust } from "../command/crust.ts";
import { createCommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";
import type { ArgDef } from "../types.ts";
import { parseArgs, parseFlagValues, parseStructured, validateParsed } from "./parser.ts";

type DynamicParser = NonNullable<Extract<ArgDef, { type: "string" }>["parse"]>;

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
			flags: { port: { type: "number", default: 3000, env: { name: "PORT" } } },
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
				color: { type: "boolean", aliases: ["colour"] },
				strict: { type: "boolean", noNegate: true, short: "s" },
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
	it("omitted variadic resolves its default as one element on both front doors", async () => {
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

		const seen: string[][] = [];
		const app = new Crust("run")
			.args({ name: "files", type: "string", variadic: true, default: "fallback" })
			.action(({ args }) => {
				seen.push(args.files);
			});
		expect(await app.execute({ argv: [] })).toBe(0);
		await unwrap(app.run([], {}));
		expect(await app.execute({ argv: ["x"] })).toBe(0);
		expect(seen).toEqual([["fallback"], ["fallback"], ["x"]]);
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
	it("fills the remaining positionals after the ones before --", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [
				{ name: "name", type: "string", required: true },
				{ name: "offset", type: "number" },
			],
		});
		const result = parseArgs(cmd, ["a", "--", "-5", "rest"]);
		expect(result.args).toEqual({ name: "a", offset: -5 });
		expect(result.excessArgs).toEqual([]);
		expect(result.rawArgs).toEqual(["rest"]);
	});

	it("lets a variadic positional consume every token after --", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "files", type: "string", variadic: true, required: true }],
		});
		const result = parseArgs(cmd, ["a", "--", "-b", "--", "c"]);
		expect(result.args.files).toEqual(["a", "-b", "--", "c"]);
		expect(result.rawArgs).toEqual([]);
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
		expect(result.rawArgs).toEqual(["--help"]);
	});

	it("still reports excess positionals before -- once every declared one is filled", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "file", type: "string" }],
		});
		const result = parseArgs(cmd, ["a", "b", "--", "c"]);
		expect(result.args.file).toBe("a");
		expect(result.excessArgs).toEqual(["b"]);
		expect(result.rawArgs).toEqual(["c"]);
	});
});

describe("parseArgs — afterDoubleDash", () => {
	const run = makeNode({
		meta: { name: "run" },
		args: [
			{ name: "task", type: "string", required: true },
			{ name: "pkgs", type: "string", variadic: true },
			{ name: "extra", type: "string", variadic: true, afterDoubleDash: true },
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
		expect(result.rawArgs).toEqual([]);
		expect(result.sources.args).toEqual({ task: "argv", pkgs: "argv", extra: "argv" });
	});

	it("never fills earlier positionals from tokens after --", () => {
		const result = parseArgs(run, ["--", "build"]);
		expect(result.args).toEqual({ task: undefined, pkgs: [], extra: ["build"] });
		expect(() => validateParsed(run, result)).toThrow(/^Missing required argument "<task>"$/);
		expect(parseArgs(run, ["build"]).args).toEqual({ task: "build", pkgs: [], extra: [] });
	});

	it("takes one token when single and passes the rest to rawArgs", () => {
		const cmd = makeNode({
			meta: { name: "exec" },
			args: [
				{ name: "pod", type: "string", required: true },
				{ name: "command", type: "string", afterDoubleDash: true },
			],
		});
		const result = parseArgs(cmd, ["web", "--", "ls", "-la"]);
		expect(result.args).toEqual({ pod: "web", command: "ls" });
		expect(result.rawArgs).toEqual(["-la"]);
		expect(result.excessArgs).toEqual([]);
		// Tokens before `--` never reach it.
		expect(parseArgs(cmd, ["web", "ls"]).excessArgs).toEqual(["ls"]);
	});

	it("reports a required one given before -- as missing, with a hint", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "script", type: "string", required: true, afterDoubleDash: true }],
		});
		const result = parseArgs(cmd, ["build"]);
		expect(result.excessArgs).toEqual(["build"]);
		expect(() => validateParsed(cmd, { ...result, excessArgs: [] })).toThrow(
			'Missing required argument "<script>" (pass it after "--")',
		);
		expect(parseArgs(cmd, ["--", "build"]).args).toEqual({ script: "build" });
	});

	it("binds structured input by name, even with an earlier argument omitted", () => {
		const result = parseStructured(run, {
			args: { task: "build", extra: ["--watch"] },
			raw: ["x"],
		});
		expect(result.args).toEqual({ task: "build", pkgs: [], extra: ["--watch"] });
		expect(result.rawArgs).toEqual(["x"]);
		expect(result.sources.args).toEqual({ task: "run", extra: "run" });
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

	it("full complex command with all features", () => {
		const cmd = makeNode({
			meta: { name: "build" },
			args: [
				{ name: "entry", type: "string", default: "src/cli.ts" },
				{ name: "extras", type: "string", variadic: true },
			],
			flags: {
				output: { type: "string", short: "o", default: "./dist" },
				port: { type: "number", short: "p" },
				minify: { type: "boolean", default: true },
				verbose: { type: "boolean", short: "v" },
			},
		});
		const result = parseArgs(cmd, [
			"main.ts",
			"extra1.ts",
			"extra2.ts",
			"-o",
			"./build",
			"-p",
			"8080",
			"--no-minify",
			"--",
			"--some-extra-flag",
		]);
		expect(result.args.entry).toBe("main.ts");
		expect(result.args.extras).toEqual(["extra1.ts", "extra2.ts", "--some-extra-flag"]);
		expect(result.flags.output).toBe("./build");
		expect(result.flags.port).toBe(8080);
		expect(result.flags.minify).toBe(false);
		expect(result.flags.verbose).toBeUndefined();
		expect(result.rawArgs).toEqual([]);
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

	it("throws for missing required arg", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", required: true }],
		});
		const parsed = parseArgs(cmd, []);
		expect(() => validateParsed(cmd, parsed)).toThrow(
			expect.objectContaining({
				code: "VALIDATION",
				message: 'Missing required argument "<file>"',
			}),
		);
	});

	it("throws for missing required flag", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: { name: { type: "string", required: true } },
		});
		const parsed = parseArgs(cmd, []);
		expect(() => validateParsed(cmd, parsed)).toThrow(
			expect.objectContaining({ code: "VALIDATION", message: 'Missing required flag "--name"' }),
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// parse escape hatch
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — parse escape hatch", () => {
	it("checks each dynamic parser result and contains rejected Promises", async () => {
		const asyncParse: DynamicParser = async (raw) => raw;
		const rejecting: DynamicParser = async () => {
			throw new Error("boom");
		};
		for (const parse of [asyncParse, rejecting]) {
			const app = new Crust("test").flags({ n: { type: "string", parse } });
			await expect(unwrap(app.run([], { flags: { n: "42" } }))).rejects.toThrow(
				"parse must be synchronous",
			);
		}
	});

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
// choices enforcement — previously hint-only
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
// Default coercion symmetry (PR #129 review follow-up)
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

	it("checks dynamic defaults against choices when definitions are consumed", () => {
		const choices: string[] = ["a", "b"];
		expect(() =>
			new Crust("test").flags({ mode: { type: "string", choices, default: "z" } }),
		).toThrow("default must be one of choices");
		expect(() =>
			new Crust("test").flags({
				tags: {
					type: "string",
					multiple: true,
					choices,
					default: ["a", "z"],
				},
			}),
		).toThrow("default must be one of choices");
		expect(() =>
			new Crust("test").args({ name: "mode", type: "string", choices, default: "z" }),
		).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				message: 'Argument "mode" default must be one of choices',
				details: { subject: "argument", name: "mode", reason: "default-outside-choices" },
			}),
		);
	});

	it("names the flag whose dynamic definition is invalid", () => {
		const choices: string[] = ["a", "b"];
		expect(() =>
			new Crust("test").flags({ mode: { type: "string", choices, default: "z" } }),
		).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				message: 'Flag "mode" default must be one of choices',
				details: { subject: "flag", name: "mode", reason: "default-outside-choices" },
			}),
		);
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
	it("prefers argv, then env, then default", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { registry: { type: "string", env: { name: "APP_REGISTRY" }, default: "npm" } },
		});
		const env = { APP_REGISTRY: "github" };
		expect(parseArgs(cmd, ["--registry", "jsr"], env).flags.registry).toBe("jsr");
		expect(parseArgs(cmd, [], env).flags.registry).toBe("github");
		expect(parseArgs(cmd, [], {}).flags.registry).toBe("npm");
	});

	it("leaves an optional flag undefined when neither argv nor env supplies it", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { token: { type: "string", env: { name: "APP_TOKEN" } } },
		});
		expect(parseArgs(cmd, [], { OTHER: "x" }).flags.token).toBeUndefined();
		expect(parseArgs(cmd, [], { APP_TOKEN: undefined }).flags.token).toBeUndefined();
	});

	it("reads only own properties of argv values and the environment", () => {
		for (const name of ["constructor", "toString", "hasOwnProperty"]) {
			const cmd = makeNode({
				meta: "test",
				flags: {
					[name]: { type: "string", env: { name: "APP_VALUE" }, default: "fallback" },
					tags: { type: "string", multiple: true, env: { name, delimiter: "," }, delimiter: "," },
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
			flags: { token: { type: "string", env: { name: "APP_TOKEN" }, required: true } },
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
				port: { type: "number", env: { name: "APP_PORT" } },
				mode: { type: "string", env: { name: "APP_MODE" }, choices: ["dev", "prod"] },
				level: { type: "string", env: { name: "APP_LEVEL" }, parse: (raw) => raw.toUpperCase() },
				home: { type: "url", env: { name: "APP_HOME" } },
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
				port: { type: "string", schema, env: { name: "APP_PORT" } },
				tags: { type: "string", schema, env: { name: "APP_TAGS", delimiter: "," }, multiple: true },
			},
		});
		const parsed = parseArgs(cmd, [], { APP_PORT: "8080", APP_TAGS: "a,b" });
		expect(parsed.flags.port).toBe("8080");
		expect(parsed.flags.tags).toEqual(["a", "b"]);
	});

	it("coerces boolean env values with the positional boolean spellings", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { color: { type: "boolean", env: { name: "APP_COLOR" }, default: true } },
		});
		// Same rule as boolean positionals: only "true" and "1" are truthy; anything
		// else (including "yes") is false. Not an enum validation.
		for (const [raw, expected] of [
			["true", true],
			["1", true],
			["false", false],
			["0", false],
			["", false],
			["yes", false],
		] as const) {
			expect(parseArgs(cmd, [], { APP_COLOR: raw }).flags.color).toBe(expected);
		}
		expect(parseArgs(cmd, ["--no-color"], { APP_COLOR: "true" }).flags.color).toBe(false);
		expect(parseArgs(cmd, ["--color"], { APP_COLOR: "false" }).flags.color).toBe(true);
	});

	it("rejects a false env value for a noNegate boolean", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { color: { type: "boolean", env: { name: "APP_COLOR" }, noNegate: true } },
		});
		expect(parseArgs(cmd, [], { APP_COLOR: "1" }).flags.color).toBe(true);
		expect(() => parseAndValidate(cmd, [], { APP_COLOR: "0" })).toThrow(
			'Flag "--color" does not support negation',
		);
	});

	it("treats an explicit argv occurrence through an alias or negation as argv presence", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				output: { type: "string", short: "o", aliases: ["out"], env: { name: "APP_OUTPUT" } },
				loud: { type: "boolean", aliases: ["noisy"], env: { name: "APP_LOUD" } },
			},
		});
		const env = { APP_OUTPUT: "from-env", APP_LOUD: "true" };
		expect(parseArgs(cmd, ["-o", "short"], env).flags.output).toBe("short");
		expect(parseArgs(cmd, ["--out", "alias"], env).flags.output).toBe("alias");
		expect(parseArgs(cmd, ["--output", ""], env).flags.output).toBe("");
		expect(parseArgs(cmd, ["--no-noisy"], env).flags.loud).toBe(false);
	});

	it("does not read env for structured input", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				token: { type: "string", env: { name: "PATH" } },
				tags: {
					type: "string",
					multiple: true,
					env: { name: "HOME", delimiter: ":" },
					delimiter: ",",
				},
			},
		});
		// PATH/HOME are set in every test environment; structured binding ignores them.
		expect(parseStructured(cmd, {}).flags.token).toBeUndefined();
		expect(parseStructured(cmd, {}).flags.tags).toBeUndefined();
		expect(parseStructured(cmd, { flags: { tags: ["a,b", "c"] } }).flags.tags).toEqual([
			"a,b",
			"c",
		]);
	});

	it("reads process.env by default on the argv path", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { home: { type: "string", env: { name: "HOME" } } },
		});
		expect(parseArgs(cmd, [])).toEqual(parseArgs(cmd, [], process.env));
		expect(parseArgs(cmd, []).flags.home).toBe(process.env.HOME);
		expect(parseArgs(cmd, [], {}).flags.home).toBeUndefined();
	});
});

describe("parseArgs \u2014 delimiter", () => {
	it.each([
		{
			delimiter: ",",
			env: { name: "APP_TAGS", delimiter: ":" },
			argv: ["a", "b:c"],
			fallback: ["a,b", "c"],
		},
		{ delimiter: ",", env: { name: "APP_TAGS" }, argv: ["a", "b:c"], fallback: ["a,b:c"] },
		{
			delimiter: undefined,
			env: { name: "APP_TAGS", delimiter: ":" },
			argv: ["a,b:c"],
			fallback: ["a,b", "c"],
		},
	])("keeps argv and env delimiters independent: %j", ({ delimiter, env, argv, fallback }) => {
		const cmd = makeNode({
			meta: "test",
			flags: { tags: { type: "string", multiple: true, delimiter, env } },
		});
		expect(parseArgs(cmd, ["--tags=a,b:c"], { APP_TAGS: "ignored" }).flags.tags).toEqual([...argv]);
		expect(parseArgs(cmd, [], { APP_TAGS: "a,b:c" }).flags.tags).toEqual([...fallback]);
		expect(parseStructured(cmd, { flags: { tags: ["a,b:c"] } }).flags.tags).toEqual(["a,b:c"]);
	});

	const cmd = makeNode({
		meta: "test",
		flags: {
			tags: {
				type: "string",
				multiple: true,
				env: { name: "APP_TAGS", delimiter: "," },
				delimiter: ",",
				default: ["x"],
			},
			ports: {
				type: "number",
				multiple: true,
				env: { name: "APP_PORTS", delimiter: ":" },
				delimiter: ":",
			},
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
				enabled: { type: "boolean", multiple: true, env: { name: "APP_ENABLED", delimiter: "," } },
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

	it("keeps scalar JSON arrays intact and passes raw input verbatim", () => {
		const command = makeNode({
			meta: "test",
			args: [{ name: "data", type: "json" }],
			flags: { data: { type: "json" } },
		});
		const data = [1, 2];
		const result = parseStructured(command, {
			args: { data },
			flags: { data },
			raw: ["--", "--literal"],
		});
		expect(result.args.data).toBe(data);
		expect(result.flags.data).toBe(data);
		expect(result.rawArgs).toEqual(["--", "--literal"]);
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
			port: { type: "number", env: { name: "PORT" } },
			level: { type: "string", choices: ["info", "debug"], env: { name: "LEVEL" } },
			upper: { type: "string", parse: (raw: string) => raw.toUpperCase(), env: { name: "UP" } },
			tags: { type: "string", multiple: true, env: { name: "TAGS", delimiter: "," } },
			on: { type: "boolean", env: { name: "ON" } },
			fallback: { type: "number", default: 7, env: { name: "UNSET" } },
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
			parseFlagValues({ port: { type: "number", env: { name: "PORT" } } }, { PORT: "x" }),
		).rejects.toMatchObject({ code: "PARSE" });
		await expect(
			parseFlagValues(
				{ port: { type: "number", default: 1, env: { name: "PORT" } } },
				{ PORT: "" },
			),
		).rejects.toMatchObject({
			code: "PARSE",
			message: "Expected a number for --port (from $PORT).",
		});
		await expect(
			parseFlagValues({ key: { type: "string", required: true, env: { name: "KEY" } } }, {}),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("rejects definitions core normalization rejects, including a __proto__ key", async () => {
		const reserved = Object.defineProperty({}, "__proto__", {
			value: { type: "string", env: { name: "X" } },
			enumerable: true,
		});
		await expect(parseFlagValues(reserved, { X: "x" })).rejects.toMatchObject({
			code: "DEFINITION",
			details: { reason: "reserved-spelling" },
		});
		await expect(
			parseFlagValues(
				{ level: { type: "string", choices: ["ok"], default: "bad", env: { name: "L" } } },
				{},
			),
		).rejects.toMatchObject({ code: "DEFINITION" });
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
			name: { type: "string", schema: upper, env: { name: "NAME" } },
			inherited: { type: "string", env: { name: "constructor" } },
		} as const;
		await expect(parseFlagValues(flags, { NAME: "crust" })).resolves.toEqual({
			name: "CRUST",
			inherited: undefined,
		});
	});
});
