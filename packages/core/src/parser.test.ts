import { describe, expect, it } from "bun:test";
import { defineCommand } from "./command.ts";
import { CrustError } from "./errors.ts";
import { parseArgs } from "./parser.ts";

// ────────────────────────────────────────────────────────────────────────────
// Boolean flags
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — boolean flags", () => {
	const cmd = defineCommand({
		meta: { name: "test" },
		flags: {
			verbose: { type: "boolean", description: "Enable verbose logging" },
		},
	});

	it("parses --verbose as true", () => {
		const result = parseArgs(cmd, ["--verbose"]);
		expect(result.flags.verbose).toBe(true);
	});

	it("defaults boolean flag to undefined when not provided", () => {
		const result = parseArgs(cmd, []);
		expect(result.flags.verbose).toBeUndefined();
	});

	it("parses --no-verbose as false", () => {
		const cmdWithDefault = defineCommand({
			meta: { name: "test" },
			flags: {
				verbose: { type: "boolean", default: true },
			},
		});
		const result = parseArgs(cmdWithDefault, ["--no-verbose"]);
		expect(result.flags.verbose).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// String flags
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — string flags", () => {
	const cmd = defineCommand({
		meta: { name: "test" },
		flags: {
			output: { type: "string", description: "Output directory" },
		},
	});

	it("parses --output value", () => {
		const result = parseArgs(cmd, ["--output", "./dist"]);
		expect(result.flags.output).toBe("./dist");
	});

	it("parses --output=value (equals syntax)", () => {
		const result = parseArgs(cmd, ["--output=./dist"]);
		expect(result.flags.output).toBe("./dist");
	});

	it("defaults string flag to undefined when not provided", () => {
		const result = parseArgs(cmd, []);
		expect(result.flags.output).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Number flags with coercion
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — number flags", () => {
	const cmd = defineCommand({
		meta: { name: "test" },
		flags: {
			port: { type: "number", description: "Port number" },
		},
	});

	it("coerces --port 3000 to number", () => {
		const result = parseArgs(cmd, ["--port", "3000"]);
		expect(result.flags.port).toBe(3000);
	});

	it("coerces --port=8080 to number", () => {
		const result = parseArgs(cmd, ["--port=8080"]);
		expect(result.flags.port).toBe(8080);
	});

	it("handles negative numbers", () => {
		// Negative numbers as separate args can be tricky with parseArgs
		// Using = syntax for robustness
		const result = parseArgs(cmd, ["--port=-1"]);
		expect(result.flags.port).toBe(-1);
	});

	it("handles float numbers", () => {
		const result = parseArgs(cmd, ["--port", "3.14"]);
		expect(result.flags.port).toBe(3.14);
	});

	it("throws CrustError with PARSE code on non-numeric value", () => {
		try {
			parseArgs(cmd, ["--port", "abc"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("PARSE");
			expect((err as CrustError).message).toBe(
				'Expected number for --port, got "abc"',
			);
		}
	});

	it("throws CrustError with PARSE code on NaN-producing value", () => {
		try {
			parseArgs(cmd, ["--port", "not-a-number"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("PARSE");
			expect((err as CrustError).message).toBe(
				'Expected number for --port, got "not-a-number"',
			);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Aliases (short and long)
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — aliases", () => {
	it("parses short alias -v", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				verbose: { type: "boolean", alias: "v" },
			},
		});
		const result = parseArgs(cmd, ["-v"]);
		expect(result.flags.verbose).toBe(true);
	});

	it("parses short alias -p with value", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				port: { type: "number", alias: "p" },
			},
		});
		const result = parseArgs(cmd, ["-p", "3000"]);
		expect(result.flags.port).toBe(3000);
	});

	it("supports array of aliases", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				output: { type: "string", alias: ["o", "out"] },
			},
		});

		// Short alias
		const result1 = parseArgs(cmd, ["-o", "./dist"]);
		expect(result1.flags.output).toBe("./dist");

		// Long alias
		const result2 = parseArgs(cmd, ["--out", "./build"]);
		expect(result2.flags.output).toBe("./build");
	});

	it("throws CrustError with DEFINITION code on alias collision", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			// @ts-expect-error — intentional alias→alias collision to test runtime check
			flags: {
				verbose: { type: "boolean", alias: "v" },
				version: { type: "boolean", alias: "v" },
			},
		});
		try {
			parseArgs(cmd, []);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toBe(
				'Alias collision: "-v" is used by both "--verbose" and "--version"',
			);
		}
	});

	it("throws CrustError with DEFINITION code on long alias shadowing flag name", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			// @ts-expect-error — alias "out" collides with flag name "out" (compile-time error)
			flags: {
				out: { type: "string", description: "Output format" },
				output: { type: "string", alias: ["o", "out"] },
			},
		});
		try {
			parseArgs(cmd, []);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toBe(
				'Alias collision: "-out" is used by both "--out" and "--output"',
			);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Multiple flags
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — multiple flags", () => {
	it("collects multiple string values into an array", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true },
			},
		});
		const result = parseArgs(cmd, ["--file", "a.ts", "--file", "b.ts"]);
		expect(result.flags.file).toEqual(["a.ts", "b.ts"]);
	});

	it("single value with multiple: true still returns array", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true },
			},
		});
		const result = parseArgs(cmd, ["--file", "a.ts"]);
		expect(result.flags.file).toEqual(["a.ts"]);
	});

	it("coerces multiple number values individually", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				port: { type: "number", multiple: true },
			},
		});
		const result = parseArgs(cmd, ["--port", "80", "--port", "443"]);
		expect(result.flags.port).toEqual([80, 443]);
	});

	it("throws on non-numeric value in multiple number flag", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				port: { type: "number", multiple: true },
			},
		});
		expect(() => parseArgs(cmd, ["--port", "80", "--port", "abc"])).toThrow(
			'Expected number for --port, got "abc"',
		);
	});

	it("collects multiple boolean values into an array", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				verbose: { type: "boolean", multiple: true },
			},
		});
		const result = parseArgs(cmd, ["--verbose", "--verbose", "--verbose"]);
		expect(result.flags.verbose).toEqual([true, true, true]);
	});

	it("returns undefined when multiple flag is not provided and has no default", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.file).toBeUndefined();
	});

	it("applies default array when multiple flag is not provided", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true, default: ["default.ts"] },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.file).toEqual(["default.ts"]);
	});

	it("throws when required multiple flag is not provided", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true, required: true },
			},
		});
		expect(() => parseArgs(cmd, [])).toThrow('Missing required flag "--file"');
	});

	it("works with short alias on multiple flag", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true, alias: "f" },
			},
		});
		const result = parseArgs(cmd, ["-f", "a.ts", "-f", "b.ts"]);
		expect(result.flags.file).toEqual(["a.ts", "b.ts"]);
	});

	it("works with long alias on multiple flag", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true, alias: ["f", "input"] },
			},
		});
		const result = parseArgs(cmd, ["--input", "a.ts", "--input", "b.ts"]);
		expect(result.flags.file).toEqual(["a.ts", "b.ts"]);
	});

	it("merges values from canonical name and aliases", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true, alias: ["f", "input"] },
			},
		});
		const result = parseArgs(cmd, [
			"--file",
			"a.ts",
			"-f",
			"b.ts",
			"--input",
			"c.ts",
		]);
		expect(result.flags.file).toEqual(["a.ts", "b.ts", "c.ts"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Default values
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — default values", () => {
	it("applies default flag value when not provided", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				port: { type: "number", default: 3000 },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.port).toBe(3000);
	});

	it("applies default arg value when not provided", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", default: "index.ts" }],
		});
		const result = parseArgs(cmd, []);
		expect(result.args.file).toBe("index.ts");
	});

	it("overrides default when value is provided", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				port: { type: "number", default: 3000 },
			},
		});
		const result = parseArgs(cmd, ["--port", "8080"]);
		expect(result.flags.port).toBe(8080);
	});

	it("applies default boolean value", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				minify: { type: "boolean", default: true },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.minify).toBe(true);
	});

	it("all-defaults scenario", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", default: "src/cli.ts" }],
			flags: {
				port: { type: "number", default: 3000 },
				verbose: { type: "boolean", default: false },
				output: { type: "string", default: "./dist" },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.args.file).toBe("src/cli.ts");
		expect(result.flags.port).toBe(3000);
		expect(result.flags.verbose).toBe(false);
		expect(result.flags.output).toBe("./dist");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Required args (success + failure)
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — required args", () => {
	const cmd = defineCommand({
		meta: { name: "test" },
		args: [{ name: "file", type: "string", required: true }],
	});

	it("succeeds when required arg is provided", () => {
		const result = parseArgs(cmd, ["input.ts"]);
		expect(result.args.file).toBe("input.ts");
	});

	it("throws CrustError with VALIDATION code when required arg is missing", () => {
		try {
			parseArgs(cmd, []);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("VALIDATION");
			expect((err as CrustError).message).toBe(
				'Missing required argument "<file>"',
			);
		}
	});

	it("required arg with a default does not throw when missing", () => {
		const cmdWithDefault = defineCommand({
			meta: { name: "test" },
			args: [
				{ name: "file", type: "string", required: true, default: "index.ts" },
			],
		});
		// When default is present, it should be applied even if required
		// (the default satisfies the requirement)
		const result = parseArgs(cmdWithDefault, []);
		expect(result.args.file).toBe("index.ts");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Required flags (success + failure)
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — required flags", () => {
	const cmd = defineCommand({
		meta: { name: "test" },
		flags: {
			name: { type: "string", required: true },
		},
	});

	it("succeeds when required flag is provided", () => {
		const result = parseArgs(cmd, ["--name", "hello"]);
		expect(result.flags.name).toBe("hello");
	});

	it("throws CrustError with VALIDATION code when required flag is missing", () => {
		try {
			parseArgs(cmd, []);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("VALIDATION");
			expect((err as CrustError).message).toBe(
				'Missing required flag "--name"',
			);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Variadic positional args
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — variadic args", () => {
	it("collects remaining positionals into an array", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "files", type: "string", variadic: true }],
		});
		const result = parseArgs(cmd, ["a.ts", "b.ts", "c.ts"]);
		expect(result.args.files).toEqual(["a.ts", "b.ts", "c.ts"]);
	});

	it("variadic with preceding regular arg", () => {
		const cmd = defineCommand({
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

	it("variadic with no remaining args produces empty array", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "files", type: "string", variadic: true }],
		});
		const result = parseArgs(cmd, []);
		expect(result.args.files).toEqual([]);
	});

	it("variadic with number coercion", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "numbers", type: "number", variadic: true }],
		});
		const result = parseArgs(cmd, ["1", "2", "3"]);
		expect(result.args.numbers).toEqual([1, 2, 3]);
	});

	it("throws CrustError with PARSE code on variadic non-numeric value", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "numbers", type: "number", variadic: true }],
		});
		try {
			parseArgs(cmd, ["1", "abc", "3"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("PARSE");
			expect((err as CrustError).message).toBe(
				'Expected number for <numbers>, got "abc"',
			);
		}
	});

	it("throws CrustError with VALIDATION code when required variadic arg receives no values", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "files", type: "string", variadic: true, required: true }],
		});
		try {
			parseArgs(cmd, []);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("VALIDATION");
			expect((err as CrustError).message).toBe(
				'Missing required argument "<files>"',
			);
		}
	});

	it("required variadic succeeds when at least one value is provided", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "files", type: "string", variadic: true, required: true }],
		});
		const result = parseArgs(cmd, ["a.ts"]);
		expect(result.args.files).toEqual(["a.ts"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// '--' separator handling
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — '--' separator", () => {
	it("passes args after -- as rawArgs", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				verbose: { type: "boolean" },
			},
		});
		const result = parseArgs(cmd, ["--verbose", "--", "extra1", "extra2"]);
		expect(result.flags.verbose).toBe(true);
		expect(result.rawArgs).toEqual(["extra1", "extra2"]);
	});

	it("args after -- are not parsed as flags", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				verbose: { type: "boolean" },
			},
		});
		// --unknown after -- should NOT throw
		const result = parseArgs(cmd, ["--", "--unknown", "value"]);
		expect(result.rawArgs).toEqual(["--unknown", "value"]);
	});

	it("-- with no following args produces empty rawArgs", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
		});
		const result = parseArgs(cmd, ["--"]);
		expect(result.rawArgs).toEqual([]);
	});

	it("rawArgs are empty when no -- separator is used", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
		});
		const result = parseArgs(cmd, ["hello"]);
		expect(result.rawArgs).toEqual([]);
	});

	it("positional args before -- are parsed, after -- go to rawArgs", () => {
		const cmd = defineCommand({
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
	const cmd = defineCommand({
		meta: { name: "test" },
		flags: {
			verbose: { type: "boolean" },
		},
	});

	it("throws CrustError with PARSE code on unknown long flag", () => {
		try {
			parseArgs(cmd, ["--unknown"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("PARSE");
			expect((err as CrustError).message).toContain("Unknown flag");
		}
	});

	it("throws CrustError with PARSE code on unknown short flag", () => {
		try {
			parseArgs(cmd, ["-x"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("PARSE");
			expect((err as CrustError).message).toContain("Unknown flag");
		}
	});

	it("does not throw on known flags", () => {
		expect(() => {
			parseArgs(cmd, ["--verbose"]);
		}).not.toThrow();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Empty argv
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — empty argv", () => {
	it("handles empty argv with no definitions", () => {
		const cmd = defineCommand({ meta: { name: "test" } });
		const result = parseArgs(cmd, []);
		expect(result.args).toEqual({});
		expect(result.flags).toEqual({});
		expect(result.rawArgs).toEqual([]);
	});

	it("handles empty argv with optional args/flags", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "file", type: "string" }],
			flags: {
				verbose: { type: "boolean" },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.args.file).toBeUndefined();
		expect(result.flags.verbose).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Complex/mixed scenarios
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — complex scenarios", () => {
	it("parses mixed positionals and flags", () => {
		const cmd = defineCommand({
			meta: { name: "serve" },
			args: [{ name: "entry", type: "string", required: true }],
			flags: {
				port: { type: "number", default: 3000, alias: "p" },
				verbose: { type: "boolean", alias: "v" },
			},
		});
		const result = parseArgs(cmd, ["src/cli.ts", "-p", "8080", "-v"]);
		expect(result.args.entry).toBe("src/cli.ts");
		expect(result.flags.port).toBe(8080);
		expect(result.flags.verbose).toBe(true);
	});

	it("parses positionals and flags in any order", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", required: true }],
			flags: {
				output: { type: "string", default: "./dist" },
			},
		});
		// Flags before positionals
		const result = parseArgs(cmd, ["--output", "./build", "input.ts"]);
		expect(result.args.file).toBe("input.ts");
		expect(result.flags.output).toBe("./build");
	});

	it("number arg coercion", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "count", type: "number", required: true }],
		});
		const result = parseArgs(cmd, ["42"]);
		expect(result.args.count).toBe(42);
	});

	it("boolean arg coercion", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "force", type: "boolean" }],
		});
		const result = parseArgs(cmd, ["true"]);
		expect(result.args.force).toBe(true);
	});

	it("full complex command with all features", () => {
		const cmd = defineCommand({
			meta: { name: "build" },
			args: [
				{ name: "entry", type: "string", default: "src/cli.ts" },
				{ name: "extras", type: "string", variadic: true },
			],
			flags: {
				output: { type: "string", alias: "o", default: "./dist" },
				port: { type: "number", alias: "p" },
				minify: { type: "boolean", default: true },
				verbose: { type: "boolean", alias: "v" },
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

	it("multiple positional args in order", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [
				{ name: "source", type: "string", required: true },
				{ name: "destination", type: "string", required: true },
			],
		});
		const result = parseArgs(cmd, ["./src", "./dest"]);
		expect(result.args.source).toBe("./src");
		expect(result.args.destination).toBe("./dest");
	});
});
