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
	const cmd = makeNode({
		meta: { name: "test" },
		flags: {
			port: { type: "number", description: "Port number" },
		},
	});

	it("coerces --port 3000 to number", () => {
		const result = parseArgs(cmd, ["--port", "3000"]);
		expect(result.flags.port).toBe(3000);
	});

	it("throws CrustError with PARSE code on non-numeric value", () => {
		expect(() => parseArgs(cmd, ["--port", "abc"])).toThrow(
			expect.objectContaining({ code: "PARSE", message: 'Expected number for --port, got "abc"' }),
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Aliases (short and long)
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — aliases", () => {
	it("registers util.parseArgs options only for canonical and alias spellings", () => {
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

		// util.parseArgs accepts `--<key>` for every registered option key, so a short
		// spelling must be reachable only through its canonical descriptor's `short`.
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
});

// ────────────────────────────────────────────────────────────────────────────
// Multiple flags
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — multiple flags", () => {
	it("collects multiple string values into an array", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true },
			},
		});
		const result = parseArgs(cmd, ["--file", "a.ts", "--file", "b.ts"]);
		expect(result.flags.file).toEqual(["a.ts", "b.ts"]);
	});

	it("coerces multiple number values individually", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				port: { type: "number", multiple: true },
			},
		});
		const result = parseArgs(cmd, ["--port", "80", "--port", "443"]);
		expect(result.flags.port).toEqual([80, 443]);
	});

	it("collects mixed --flag and --no-flag into array with multiple: true", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				verbose: { type: "boolean", multiple: true },
			},
		});
		const result = parseArgs(cmd, ["--verbose", "--no-verbose", "--verbose"]);
		expect(result.flags.verbose).toEqual([true, false, true]);
	});

	it("applies default array when multiple flag is not provided", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true, default: ["default.ts"] },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.file).toEqual(["default.ts"]);
	});

	it("merges values from canonical name and aliases", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				file: {
					type: "string",
					multiple: true,
					short: "f",
					aliases: ["input"],
				},
			},
		});
		const result = parseArgs(cmd, ["--file", "a.ts", "-f", "b.ts", "--input", "c.ts"]);
		expect(result.flags.file).toEqual(["a.ts", "b.ts", "c.ts"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Default values
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — default values", () => {
	it("applies default flag value when not provided", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				port: { type: "number", default: 3000 },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.port).toBe(3000);
	});

	it("applies default arg value when not provided", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", default: "index.ts" }],
		});
		const result = parseArgs(cmd, []);
		expect(result.args.file).toBe("index.ts");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Required args (success + failure)
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — required args", () => {
	const cmd = makeNode({
		meta: { name: "test" },
		args: [{ name: "file", type: "string", required: true }],
	});

	it("returns undefined for missing required arg (no validation)", () => {
		const result = parseArgs(cmd, []);
		expect(result.args.file).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Required flags (success + failure)
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — required flags", () => {
	const cmd = makeNode({
		meta: { name: "test" },
		flags: {
			name: { type: "string", required: true },
		},
	});

	it("returns undefined for missing required flag (no validation)", () => {
		const result = parseArgs(cmd, []);
		expect(result.flags.name).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Variadic positional args
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — variadic args", () => {
	it("collects remaining positionals into an array", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "files", type: "string", variadic: true }],
		});
		const result = parseArgs(cmd, ["a.ts", "b.ts", "c.ts"]);
		expect(result.args.files).toEqual(["a.ts", "b.ts", "c.ts"]);
	});

	it("variadic with preceding regular arg", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [
				{ name: "target", type: "string", required: true },
				{ name: "files", type: "string", variadic: true },
			],
		});
		const result = parseArgs(cmd, ["build", "a.ts", "b.ts"]);
		expect(result.args.target).toBe("build");
		expect(result.args.files).toEqual(["a.ts", "b.ts"]);
	});

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

	it("variadic with number coercion", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "numbers", type: "number", variadic: true }],
		});
		const result = parseArgs(cmd, ["1", "2", "3"]);
		expect(result.args.numbers).toEqual([1, 2, 3]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// '--' separator handling
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — '--' separator", () => {
	it("positional args before -- are parsed, after -- go to rawArgs", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", required: true }],
		});
		const result = parseArgs(cmd, ["input.ts", "--", "--extra"]);
		expect(result.args.file).toBe("input.ts");
		expect(result.rawArgs).toEqual(["--extra"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unknown flag errors (strict mode)
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — strict mode (unknown flags)", () => {
	const cmd = makeNode({
		meta: { name: "test" },
		flags: {
			verbose: { type: "boolean" },
		},
	});

	it.each([
		["--unknown", "unknown"],
		["--unknown=value", "unknown"],
		["-x", "x"],
	])("reports unknown flag %s with structured details", (token, flag) => {
		expect(() => parseArgs(cmd, [token])).toThrow(
			expect.objectContaining({
				code: "PARSE",
				message: expect.stringContaining("Unknown flag"),
				details: { flag, reason: "unknown-flag" },
			}),
		);
	});

	it("preserves the flag name when its value is missing", () => {
		const valued = makeNode({
			meta: { name: "test" },
			flags: { output: { type: "string" } },
		});

		expect(() => parseArgs(valued, ["--output"])).toThrow(
			expect.objectContaining({ code: "PARSE", message: expect.stringContaining("--output") }),
		);
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
		expect(result.args.extras).toEqual(["extra1.ts", "extra2.ts"]);
		expect(result.flags.output).toBe("./build");
		expect(result.flags.port).toBe(8080);
		expect(result.flags.minify).toBe(false);
		expect(result.flags.verbose).toBeUndefined();
		expect(result.rawArgs).toEqual(["--some-extra-flag"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Alias-symmetric negation (--no-<alias> works; noNegate enforced)
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — boolean negation", () => {
	const cmd = makeNode({
		meta: { name: "test" },
		flags: {
			verbose: { type: "boolean", short: "v", aliases: ["loud"] },
		},
	});

	it("last-token-wins across mixed spellings", () => {
		const result = parseArgs(cmd, ["--verbose", "--no-loud"]);
		expect(result.flags.verbose).toBe(false);

		// Regression: parseArgs values group by key, so a repeated earlier
		// spelling must not shadow the final token.
		const result2 = parseArgs(cmd, ["--verbose", "--no-loud", "--verbose"]);
		expect(result2.flags.verbose).toBe(true);
	});

	it("rejects negation of a noNegate boolean via any spelling", () => {
		const noNegateCmd = makeNode({
			meta: { name: "test" },
			flags: {
				version: { type: "boolean", noNegate: true, aliases: ["ver"] },
			},
		});

		for (const spelling of ["--no-version", "--no-ver"]) {
			expect(() => parseArgs(noNegateCmd, [spelling])).toThrow(
				expect.objectContaining({
					code: "PARSE",
					message: `Flag "--version" does not support negation ("${spelling}")`,
				}),
			);
		}
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

	it("does not throw for required arg with default when missing", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", required: true, default: "index.ts" }],
		});
		const parsed = parseArgs(cmd, []);
		expect(() => validateParsed(cmd, parsed)).not.toThrow();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// url / path / json built-in types
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — url/path/json types", () => {
	it("parses a url flag into a URL instance (coercion details covered in coercers.test.ts)", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { endpoint: { type: "url" } },
		});
		const result = parseArgs(cmd, ["--endpoint", "https://example.com"]);
		expect(result.flags.endpoint).toBeInstanceOf(URL);
	});

	it("parses a path flag into an absolute string (coercion details covered in coercers.test.ts)", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { out: { type: "path" } },
		});
		const result = parseArgs(cmd, ["--out", "./dist"]);
		expect(result.flags.out).toBe(resolve(process.cwd(), "dist"));
	});

	it("parses a json flag into the corresponding value", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { config: { type: "json" } },
		});
		const result = parseArgs(cmd, ["--config", '{"k":1}']);
		expect(result.flags.config).toEqual({ k: 1 });
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
			const app = new Crust("test").flags({ name: "n", type: "string", parse });
			await expect(unwrap(app.run([], { flags: { n: "42" } }))).rejects.toThrow(
				"parse must be synchronous",
			);
		}
	});

	it("runs parse on the raw argv value", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { n: { type: "string", parse: (s) => Number(s) } },
		});
		const result = parseArgs(cmd, ["--n", "42"]);
		expect(result.flags.n).toBe(42);
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

	it("parses declared defaults when argv omits the flag", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				port: { type: "string", parse: (s) => Number(s), default: "3000" },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.port).toBe(3000);
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
		expect(() => parseArgs(cmd, ["--n", "x"])).toThrow(
			expect.objectContaining({ code: "PARSE", message: "Failed to parse --n: custom failure" }),
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// choices enforcement — previously hint-only
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — choices enforcement", () => {
	it("rejects a value not in the choices list with CrustError(PARSE)", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { mode: { type: "string", choices: ["a", "b"] as const } },
		});
		let err: unknown;
		try {
			parseArgs(cmd, ["--mode", "c"]);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(CrustError);
		expect((err as Error).message).toMatch(/Invalid value/);
	});

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
		expect(() => parseArgs(cmd, ["--n", "3"])).toThrow(CrustError);
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
		expect(() => parseArgs(cmd, ["--tags", "a", "--tags", "z"])).toThrow(CrustError);
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
	it("runs coercePath on a `type: path` flag default when argv is absent", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { out: { type: "path", default: "./dist" } },
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.out).toBe(`${process.cwd()}/dist`);
	});

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
			new Crust("test").flags({ name: "mode", type: "string", choices, default: "z" }),
		).toThrow("default must be one of choices");
		expect(() =>
			new Crust("test").flags({
				name: "tags",
				type: "string",
				multiple: true,
				choices,
				default: ["a", "z"],
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
			new Crust("test").flags({ name: "mode", type: "string", choices, default: "z" }),
		).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				message: 'Flag "mode" default must be one of choices',
				details: { subject: "flag", name: "mode", reason: "default-outside-choices" },
			}),
		);
		const short: string = "vv";
		expect(() => new Crust("test").flags({ name: "verbose", type: "boolean", short })).toThrow(
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

		expect(() => parseArgs(cmd, [], { APP_PORT: "nope" })).toThrow(
			'Expected number for --port, got "nope"',
		);
		expect(() => parseArgs(cmd, [], { APP_MODE: "test" })).toThrow(
			'Invalid value "test" for --mode. Expected one of: dev, prod',
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
		expect(() => parseArgs(cmd, [], { APP_COLOR: "0" })).toThrow(
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
		expect(() => parseArgs(cmd, [], { APP_PORTS: "80:nope" })).toThrow(
			'Expected number for --ports, got "nope"',
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
			'Invalid value "90" for --port. Expected one of: 80',
		);
		expect(() => parseStructured(command, { args: { port: "90" } })).toThrow(
			'Invalid value "90" for <port>. Expected one of: 80',
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
