import { describe, expect, it } from "bun:test";

import type { CommandNode } from "../command/node.ts";
import { computeEffectiveFlags, createCommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";
import type { ArgsDef, CommandMeta, FlagsDef } from "../types.ts";
import { parseArgs, validateParsed } from "./parser.ts";

/**
 * Test helper: creates a CommandNode from a config object for test fixtures.
 */
function makeNode(config: {
	meta: string | CommandMeta;
	args?: ArgsDef;
	flags?: FlagsDef;
	subCommands?: Record<string, CommandNode>;
	run?: (ctx: unknown) => void | Promise<void>;
}): CommandNode {
	const meta = typeof config.meta === "string" ? { name: config.meta } : config.meta;
	const node = createCommandNode(meta.name);
	if (meta.description) node.meta.description = meta.description;
	if (meta.usage) node.meta.usage = meta.usage;
	if (config.flags) {
		node.localFlags = { ...config.flags };
		node.effectiveFlags = { ...config.flags };
	}
	if (config.args) {
		node.args = [...config.args];
	}
	if (config.subCommands) {
		node.subCommands = { ...config.subCommands };
	}
	if (config.run) {
		node.run = config.run;
	}
	return node;
}

// ────────────────────────────────────────────────────────────────────────────
// Boolean flags
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — boolean flags", () => {
	const cmd = makeNode({
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
		const cmdWithDefault = makeNode({
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
	const cmd = makeNode({
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
			expect((err as CrustError).message).toBe('Expected number for --port, got "abc"');
		}
	});

	it("throws CrustError with PARSE code on NaN-producing value", () => {
		try {
			parseArgs(cmd, ["--port", "not-a-number"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("PARSE");
			expect((err as CrustError).message).toBe('Expected number for --port, got "not-a-number"');
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Aliases (short and long)
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — aliases", () => {
	it("parses short alias -v", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				verbose: { type: "boolean", short: "v" },
			},
		});
		const result = parseArgs(cmd, ["-v"]);
		expect(result.flags.verbose).toBe(true);
	});

	it("parses short alias -p with value", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				port: { type: "number", short: "p" },
			},
		});
		const result = parseArgs(cmd, ["-p", "3000"]);
		expect(result.flags.port).toBe(3000);
	});

	it("supports array of aliases", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				output: { type: "string", short: "o", aliases: ["out"] },
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
		const cmd = makeNode({
			meta: "alias-collision",
			flags: {
				verbose: { type: "boolean" as const, short: "v" },
				version: { type: "boolean" as const, short: "v" },
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
		const cmd = makeNode({
			meta: "alias-shadow",
			flags: {
				out: { type: "string" as const, description: "Output format" },
				output: { type: "string" as const, short: "o", aliases: ["out"] },
			},
		});
		try {
			parseArgs(cmd, []);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toBe(
				'Alias collision: "--out" is used by both "--out" and "--output"',
			);
		}
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

	it("single value with multiple: true still returns array", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true },
			},
		});
		const result = parseArgs(cmd, ["--file", "a.ts"]);
		expect(result.flags.file).toEqual(["a.ts"]);
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

	it("throws on non-numeric value in multiple number flag", () => {
		const cmd = makeNode({
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
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				verbose: { type: "boolean", multiple: true },
			},
		});
		const result = parseArgs(cmd, ["--verbose", "--verbose", "--verbose"]);
		expect(result.flags.verbose).toEqual([true, true, true]);
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

	it("collects only --no-flag values into array with multiple: true", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				verbose: { type: "boolean", multiple: true },
			},
		});
		const result = parseArgs(cmd, ["--no-verbose", "--no-verbose"]);
		expect(result.flags.verbose).toEqual([false, false]);
	});

	it("returns undefined when multiple flag is not provided and has no default", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.file).toBeUndefined();
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

	it("returns undefined for missing required multiple flag (no validation)", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true, required: true },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.file).toBeUndefined();
	});

	it("works with short alias on multiple flag", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				file: { type: "string", multiple: true, short: "f" },
			},
		});
		const result = parseArgs(cmd, ["-f", "a.ts", "-f", "b.ts"]);
		expect(result.flags.file).toEqual(["a.ts", "b.ts"]);
	});

	it("works with long alias on multiple flag", () => {
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
		const result = parseArgs(cmd, ["--input", "a.ts", "--input", "b.ts"]);
		expect(result.flags.file).toEqual(["a.ts", "b.ts"]);
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
		expect((result.args as Record<string, unknown>).file).toBe("index.ts");
	});

	it("overrides default when value is provided", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				port: { type: "number", default: 3000 },
			},
		});
		const result = parseArgs(cmd, ["--port", "8080"]);
		expect(result.flags.port).toBe(8080);
	});

	it("applies default boolean value", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: {
				minify: { type: "boolean", default: true },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.minify).toBe(true);
	});

	it("all-defaults scenario", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", default: "src/cli.ts" }],
			flags: {
				port: { type: "number", default: 3000 },
				verbose: { type: "boolean", default: false },
				output: { type: "string", default: "./dist" },
			},
		});
		const result = parseArgs(cmd, []);
		expect((result.args as Record<string, unknown>).file).toBe("src/cli.ts");
		expect(result.flags.port).toBe(3000);
		expect(result.flags.verbose).toBe(false);
		expect(result.flags.output).toBe("./dist");
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

	it("succeeds when required arg is provided", () => {
		const result = parseArgs(cmd, ["input.ts"]);
		expect((result.args as Record<string, unknown>).file).toBe("input.ts");
	});

	it("returns undefined for missing required arg (no validation)", () => {
		const result = parseArgs(cmd, []);
		expect((result.args as Record<string, unknown>).file).toBeUndefined();
	});

	it("required arg with a default does not throw when missing", () => {
		const cmdWithDefault = makeNode({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", required: true, default: "index.ts" }],
		});
		// When default is present, it should be applied even if required
		// (the default satisfies the requirement)
		const result = parseArgs(cmdWithDefault, []);
		expect((result.args as Record<string, unknown>).file).toBe("index.ts");
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

	it("succeeds when required flag is provided", () => {
		const result = parseArgs(cmd, ["--name", "hello"]);
		expect(result.flags.name).toBe("hello");
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
		expect((result.args as Record<string, unknown>).files).toEqual(["a.ts", "b.ts", "c.ts"]);
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
		expect((result.args as Record<string, unknown>).target).toBe("build");
		expect((result.args as Record<string, unknown>).files).toEqual(["a.ts", "b.ts"]);
	});

	it("variadic with no remaining args produces empty array", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "files", type: "string", variadic: true }],
		});
		const result = parseArgs(cmd, []);
		expect((result.args as Record<string, unknown>).files).toEqual([]);
	});

	it("variadic with number coercion", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "numbers", type: "number", variadic: true }],
		});
		const result = parseArgs(cmd, ["1", "2", "3"]);
		expect((result.args as Record<string, unknown>).numbers).toEqual([1, 2, 3]);
	});

	it("throws CrustError with PARSE code on variadic non-numeric value", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "numbers", type: "number", variadic: true }],
		});
		try {
			parseArgs(cmd, ["1", "abc", "3"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("PARSE");
			expect((err as CrustError).message).toBe('Expected number for <numbers>, got "abc"');
		}
	});

	it("returns empty array for missing required variadic arg (no validation)", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "files", type: "string", variadic: true, required: true }],
		});
		const result = parseArgs(cmd, []);
		expect((result.args as Record<string, unknown>).files).toEqual([]);
	});

	it("required variadic succeeds when at least one value is provided", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "files", type: "string", variadic: true, required: true }],
		});
		const result = parseArgs(cmd, ["a.ts"]);
		expect((result.args as Record<string, unknown>).files).toEqual(["a.ts"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// '--' separator handling
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — '--' separator", () => {
	it("passes args after -- as rawArgs", () => {
		const cmd = makeNode({
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
		const cmd = makeNode({
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
		const cmd = makeNode({
			meta: { name: "test" },
		});
		const result = parseArgs(cmd, ["--"]);
		expect(result.rawArgs).toEqual([]);
	});

	it("rawArgs are empty when no -- separator is used", () => {
		const cmd = makeNode({
			meta: { name: "test" },
		});
		const result = parseArgs(cmd, ["hello"]);
		expect(result.rawArgs).toEqual([]);
	});

	it("positional args before -- are parsed, after -- go to rawArgs", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", required: true }],
		});
		const result = parseArgs(cmd, ["input.ts", "--", "--extra"]);
		expect((result.args as Record<string, unknown>).file).toBe("input.ts");
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
		const cmd = makeNode({ meta: { name: "test" } });
		const result = parseArgs(cmd, []);
		expect(result.args).toEqual({});
		expect(result.flags).toEqual({});
		expect(result.rawArgs).toEqual([]);
	});

	it("handles empty argv with optional args/flags", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "file", type: "string" }],
			flags: {
				verbose: { type: "boolean" },
			},
		});
		const result = parseArgs(cmd, []);
		expect((result.args as Record<string, unknown>).file).toBeUndefined();
		expect(result.flags.verbose).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Complex/mixed scenarios
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — complex scenarios", () => {
	it("parses mixed positionals and flags", () => {
		const cmd = makeNode({
			meta: { name: "serve" },
			args: [{ name: "entry", type: "string", required: true }],
			flags: {
				port: { type: "number", default: 3000, short: "p" },
				verbose: { type: "boolean", short: "v" },
			},
		});
		const result = parseArgs(cmd, ["src/cli.ts", "-p", "8080", "-v"]);
		expect((result.args as Record<string, unknown>).entry).toBe("src/cli.ts");
		expect(result.flags.port).toBe(8080);
		expect(result.flags.verbose).toBe(true);
	});

	it("parses positionals and flags in any order", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", required: true }],
			flags: {
				output: { type: "string", default: "./dist" },
			},
		});
		// Flags before positionals
		const result = parseArgs(cmd, ["--output", "./build", "input.ts"]);
		expect((result.args as Record<string, unknown>).file).toBe("input.ts");
		expect(result.flags.output).toBe("./build");
	});

	it("number arg coercion", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "count", type: "number", required: true }],
		});
		const result = parseArgs(cmd, ["42"]);
		expect((result.args as Record<string, unknown>).count).toBe(42);
	});

	it("boolean arg coercion", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "force", type: "boolean" }],
		});
		const result = parseArgs(cmd, ["true"]);
		expect((result.args as Record<string, unknown>).force).toBe(true);
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
		expect((result.args as Record<string, unknown>).entry).toBe("main.ts");
		expect((result.args as Record<string, unknown>).extras).toEqual(["extra1.ts", "extra2.ts"]);
		expect(result.flags.output).toBe("./build");
		expect(result.flags.port).toBe(8080);
		expect(result.flags.minify).toBe(false);
		expect(result.flags.verbose).toBeUndefined();
		expect(result.rawArgs).toEqual(["--some-extra-flag"]);
	});

	it("multiple positional args in order", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [
				{ name: "source", type: "string", required: true },
				{ name: "destination", type: "string", required: true },
			],
		});
		const result = parseArgs(cmd, ["./src", "./dest"]);
		expect((result.args as Record<string, unknown>).source).toBe("./src");
		expect((result.args as Record<string, unknown>).destination).toBe("./dest");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Boolean flag value assignment errors (--flag=false)
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — boolean flag value assignment", () => {
	const cmd = makeNode({
		meta: { name: "test" },
		flags: {
			verbose: { type: "boolean" },
		},
	});

	it("throws CrustError with PARSE code on --flag=false", () => {
		try {
			parseArgs(cmd, ["--verbose=false"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("PARSE");
			expect((err as CrustError).message).toBe("Failed to parse command arguments");
			expect((err as CrustError).cause).toBeInstanceOf(Error);
			expect(((err as CrustError).cause as Error).message).toContain(
				"Option '--verbose' does not take an argument",
			);
		}
	});

	it("throws CrustError with PARSE code on --flag=true", () => {
		try {
			parseArgs(cmd, ["--verbose=true"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("PARSE");
			expect((err as CrustError).message).toBe("Failed to parse command arguments");
			expect((err as CrustError).cause).toBeInstanceOf(Error);
			expect(((err as CrustError).cause as Error).message).toContain(
				"Option '--verbose' does not take an argument",
			);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Negated boolean flag with value assignment (--no-flag=value)
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — negated boolean flag with value assignment", () => {
	const cmd = makeNode({
		meta: { name: "test" },
		flags: {
			verbose: { type: "boolean" },
		},
	});

	// Node's parseArgs does not recognize --no-<flag>=<value> as a combined
	// form, so it surfaces as an "Unknown option" error rather than the
	// "does not take an argument" path used for --flag=value.
	it("throws CrustError with PARSE code on --no-flag=true", () => {
		try {
			parseArgs(cmd, ["--no-verbose=true"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("PARSE");
			expect((err as CrustError).message).toBe('Unknown flag "--no-verbose"');
		}
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

	it("allows --no-<canonical> (--no-verbose)", () => {
		const result = parseArgs(cmd, ["--no-verbose"]);
		expect(result.flags.verbose).toBe(false);
	});

	it("allows --<canonical> (--verbose)", () => {
		const result = parseArgs(cmd, ["--verbose"]);
		expect(result.flags.verbose).toBe(true);
	});

	it("allows positive long alias (--loud)", () => {
		const result = parseArgs(cmd, ["--loud"]);
		expect(result.flags.verbose).toBe(true);
	});

	it("allows positive short alias (-v)", () => {
		const result = parseArgs(cmd, ["-v"]);
		expect(result.flags.verbose).toBe(true);
	});

	it("allows --no-<long-alias> (--no-loud sets canonical false)", () => {
		const result = parseArgs(cmd, ["--no-loud"]);
		expect(result.flags.verbose).toBe(false);
	});

	it("last-token-wins across mixed spellings", () => {
		const result = parseArgs(cmd, ["--verbose", "--no-loud"]);
		expect(result.flags.verbose).toBe(false);

		// Regression: parseArgs values group by key, so a repeated earlier
		// spelling must not shadow the final token.
		const result2 = parseArgs(cmd, ["--verbose", "--no-loud", "--verbose"]);
		expect(result2.flags.verbose).toBe(true);
	});

	it("multiple flags preserve argv order across mixed aliases", () => {
		const multiCmd = makeNode({
			meta: { name: "test" },
			flags: {
				tag: { type: "string", multiple: true, short: "t", aliases: ["label"] },
			},
		});
		const result = parseArgs(multiCmd, ["-t", "a", "--label", "b", "--tag", "c"]);
		expect(result.flags.tag).toEqual(["a", "b", "c"]);
	});

	it("rejects negation of a noNegate boolean via any spelling", () => {
		const noNegateCmd = makeNode({
			meta: { name: "test" },
			flags: {
				version: { type: "boolean", noNegate: true, aliases: ["ver"] },
			},
		});

		for (const spelling of ["--no-version", "--no-ver"]) {
			try {
				parseArgs(noNegateCmd, [spelling]);
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustError);
				expect((err as CrustError).code).toBe("PARSE");
				expect((err as CrustError).message).toBe(
					`Flag "--version" does not support negation ("${spelling}")`,
				);
			}
		}
	});

	it("last-token-wins for canonical positive/negative", () => {
		const result1 = parseArgs(cmd, ["--verbose", "--no-verbose"]);
		expect(result1.flags.verbose).toBe(false);

		const result2 = parseArgs(cmd, ["--no-verbose", "--verbose"]);
		expect(result2.flags.verbose).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Defense-in-depth: "no-" prefixed flag names in parser
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — no- prefix defense-in-depth", () => {
	it("throws CrustError with DEFINITION code on no- prefixed flag name", () => {
		const cmd = makeNode({
			meta: "no-prefix",
			flags: { "no-cache": { type: "boolean" as const } },
		});
		try {
			parseArgs(cmd, []);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain('Flag "--no-cache" must not use "no-" prefix');
		}
	});

	it("throws CrustError with DEFINITION code on no- prefixed alias", () => {
		const cmd = makeNode({
			meta: "no-prefix-alias",
			flags: { cache: { type: "boolean" as const, aliases: ["no-store"] } },
		});
		try {
			parseArgs(cmd, []);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain(
				'Alias "--no-store" on "--cache" must not use "no-" prefix',
			);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// CommandNode — parsing with effective (merged) flags
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — CommandNode with effective flags", () => {
	it("parses inherited flag from effectiveFlags", () => {
		const parentFlags = {
			verbose: { type: "boolean" as const, inherit: true as const },
		};
		const localFlags = {
			output: { type: "string" as const },
		};

		const node = createCommandNode("child");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		const result = parseArgs(node, ["--verbose", "--output", "./dist"]);
		expect(result.flags.verbose).toBe(true);
		expect(result.flags.output).toBe("./dist");
	});

	it("overridden flag uses local type, not inherited type", () => {
		const parentFlags = {
			level: {
				type: "boolean" as const,
				inherit: true as const,
			},
		};
		const localFlags = {
			level: {
				type: "number" as const,
			},
		};

		const node = createCommandNode("child");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		// level is now a number flag (local override), not boolean
		const result = parseArgs(node, ["--level", "5"]);
		expect(result.flags.level).toBe(5);
	});

	it("inherited required flag is enforced by validateParsed", () => {
		const parentFlags = {
			config: {
				type: "string" as const,
				required: true as const,
				inherit: true as const,
			},
		};
		const localFlags = {};

		const node = createCommandNode("child");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		// parseArgs does not throw — validation is separate
		const parsed = parseArgs(node, []);
		expect(parsed.flags.config).toBeUndefined();

		// validateParsed enforces required constraints
		try {
			validateParsed(node, parsed);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("VALIDATION");
			expect((err as CrustError).message).toBe('Missing required flag "--config"');
		}
	});

	it("inherited alias works on subcommand", () => {
		const parentFlags = {
			verbose: {
				type: "boolean" as const,
				short: "v" as const,
				inherit: true as const,
			},
		};
		const localFlags = {};

		const node = createCommandNode("child");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		const result = parseArgs(node, ["-v"]);
		expect(result.flags.verbose).toBe(true);
	});

	it("non-inherit parent flags are excluded from effectiveFlags", () => {
		const parentFlags = {
			verbose: { type: "boolean" as const, inherit: true as const },
			debug: { type: "boolean" as const }, // no inherit
		};
		const localFlags = {};

		const node = createCommandNode("child");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		// verbose is inherited, debug is not
		const result = parseArgs(node, ["--verbose"]);
		expect(result.flags.verbose).toBe(true);

		// --debug should be unknown since it's not inherited
		try {
			parseArgs(node, ["--debug"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("PARSE");
			expect((err as CrustError).message).toContain("Unknown flag");
		}
	});

	it("inherited flag with default value works on subcommand", () => {
		const parentFlags = {
			port: {
				type: "number" as const,
				default: 3000,
				inherit: true as const,
			},
		};
		const localFlags = {};

		const node = createCommandNode("child");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		// Default should apply when not provided
		const result1 = parseArgs(node, []);
		expect(result1.flags.port).toBe(3000);

		// Explicit value should override default
		const result2 = parseArgs(node, ["--port", "8080"]);
		expect(result2.flags.port).toBe(8080);
	});

	it("CommandNode with no effective flags parses correctly", () => {
		const node = createCommandNode("bare");
		const result = parseArgs(node, ["positional"]);
		expect(result.flags).toEqual({});
		expect(result.rawArgs).toEqual([]);
	});

	it("CommandNode with args parses positionals correctly", () => {
		const node = createCommandNode("child");
		node.args = [{ name: "file", type: "string", required: true }];
		node.effectiveFlags = computeEffectiveFlags(
			{ verbose: { type: "boolean" as const, inherit: true as const } },
			{},
		);

		const result = parseArgs(node, ["--verbose", "input.ts"]);
		expect(result.flags.verbose).toBe(true);
		expect((result.args as Record<string, unknown>).file).toBe("input.ts");
	});

	it("inherited boolean negation works on subcommand", () => {
		const parentFlags = {
			minify: {
				type: "boolean" as const,
				default: true,
				inherit: true as const,
			},
		};
		const localFlags = {};

		const node = createCommandNode("child");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		const result = parseArgs(node, ["--no-minify"]);
		expect(result.flags.minify).toBe(false);
	});

	it("inherited multiple flag works on subcommand", () => {
		const parentFlags = {
			include: {
				type: "string" as const,
				multiple: true as const,
				inherit: true as const,
			},
		};
		const localFlags = {};

		const node = createCommandNode("child");
		node.localFlags = localFlags;
		node.effectiveFlags = computeEffectiveFlags(parentFlags, localFlags);

		const result = parseArgs(node, ["--include", "src", "--include", "lib"]);
		expect(result.flags.include).toEqual(["src", "lib"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// validateParsed
// ────────────────────────────────────────────────────────────────────────────

describe("validateParsed", () => {
	it("throws for missing required arg", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", required: true }],
		});
		const parsed = parseArgs(cmd, []);
		try {
			validateParsed(cmd, parsed);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("VALIDATION");
			expect((err as CrustError).message).toBe('Missing required argument "<file>"');
		}
	});

	it("throws for missing required flag", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			flags: { name: { type: "string", required: true } },
		});
		const parsed = parseArgs(cmd, []);
		try {
			validateParsed(cmd, parsed);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("VALIDATION");
			expect((err as CrustError).message).toBe('Missing required flag "--name"');
		}
	});

	it("throws for missing required variadic arg", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "files", type: "string", variadic: true, required: true }],
		});
		const parsed = parseArgs(cmd, []);
		try {
			validateParsed(cmd, parsed);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("VALIDATION");
			expect((err as CrustError).message).toBe('Missing required argument "<files>"');
		}
	});

	it("does not throw when all required values are provided", () => {
		const cmd = makeNode({
			meta: { name: "test" },
			args: [{ name: "file", type: "string", required: true }],
			flags: { name: { type: "string", required: true } },
		});
		const parsed = parseArgs(cmd, ["--name", "hello", "input.ts"]);
		expect(() => validateParsed(cmd, parsed)).not.toThrow();
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
// Schema-backed args with no parser type hint
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — raw schema-backed args", () => {
	it("throws DEFINITION when dynamic flag definitions omit parser type", () => {
		const cmd = makeNode({
			meta: { name: "invalid-flag" },
			flags: { verbose: {} as never },
		});
		expect(() => parseArgs(cmd, [])).toThrow(
			'Flag "--verbose" must declare a parser type ("string", "number", "boolean", "url", "path", or "json")',
		);
	});

	it("keeps untyped positional args as raw strings", () => {
		const cmd = makeNode({
			meta: { name: "raw-arg" },
			args: [{ name: "port" }],
		});
		const result = parseArgs(cmd, ["3000"]);
		expect((result.args as Record<string, unknown>).port).toBe("3000");
	});

	it("keeps untyped variadic args as raw string arrays", () => {
		const cmd = makeNode({
			meta: { name: "raw-variadic" },
			args: [{ name: "files", variadic: true }],
		});
		const result = parseArgs(cmd, ["a.ts", "b.ts"]);
		expect((result.args as Record<string, unknown>).files).toEqual(["a.ts", "b.ts"]);
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

	it("throws CrustError(PARSE) on an invalid url flag value", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { endpoint: { type: "url" } },
		});
		expect(() => parseArgs(cmd, ["--endpoint", "not-a-url"])).toThrow(CrustError);
	});

	it("parses a path flag into an absolute string (coercion details covered in coercers.test.ts)", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { out: { type: "path" } },
		});
		const result = parseArgs(cmd, ["--out", "./dist"]);
		expect(typeof result.flags.out).toBe("string");
	});

	it("parses a json flag into the corresponding value", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { config: { type: "json" } },
		});
		const result = parseArgs(cmd, ["--config", '{"k":1}']);
		expect(result.flags.config).toEqual({ k: 1 });
	});

	it("throws CrustError(PARSE) on invalid json", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { config: { type: "json" } },
		});
		expect(() => parseArgs(cmd, ["--config", "not json"])).toThrow(CrustError);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// parse escape hatch
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — parse escape hatch", () => {
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

	it("runs parse on default when argv is absent (oracle C regression)", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				port: { type: "string", parse: (s) => Number(s), default: "3000" },
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.port).toBe(3000);
	});

	it("returns undefined when argv and default are both absent (no parse call)", () => {
		let called = false;
		const cmd = makeNode({
			meta: "test",
			flags: {
				port: {
					type: "string",
					parse: (s) => {
						called = true;
						return Number(s);
					},
				},
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.port).toBeUndefined();
		expect(called).toBe(false);
	});

	it("argv overrides default and runs parse on argv", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				port: { type: "string", parse: (s) => Number(s), default: "3000" },
			},
		});
		const result = parseArgs(cmd, ["--port", "8080"]);
		expect(result.flags.port).toBe(8080);
	});

	it("rejects async parse at setup with CrustError(DEFINITION)", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				endpoint: { type: "string", parse: async (s: string) => s },
			},
		});
		try {
			parseArgs(cmd, []);
			expect.unreachable("parseArgs should have rejected async parse");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const e = err as CrustError;
			expect(e.code).toBe("DEFINITION");
			expect(e.message).toMatch(/Async parse not supported/);
			expect(e.message).toContain("--endpoint");
		}
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
		try {
			parseArgs(cmd, ["--n", "x"]);
			expect.unreachable("parseArgs should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const e = err as CrustError;
			expect(e.code).toBe("PARSE");
			expect(e.message).toContain("--n");
			expect(e.message).toContain("custom failure");
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// choices enforcement — previously hint-only
// ────────────────────────────────────────────────────────────────────────────

describe("parseArgs — choices enforcement", () => {
	it("passes a value that is in the choices list", () => {
		const cmd = makeNode({
			meta: "test",
			flags: { mode: { type: "string", choices: ["a", "b"] as const } },
		});
		const result = parseArgs(cmd, ["--mode", "a"]);
		expect(result.flags.mode).toBe("a");
	});

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

	it("runs parse on a valid choice value", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				n: {
					type: "string",
					choices: ["1", "2"] as const,
					parse: (s) => Number(s),
				},
			},
		});
		const result = parseArgs(cmd, ["--n", "1"]);
		expect(result.flags.n).toBe(1);
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
// branch must mirror that so omitted-flag behavior is not silently weaker
// (path defaults left relative, defaults outside `choices` accepted, etc.).
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

	it("runs coercePath on a `type: path` arg default when positional is absent", () => {
		const cmd = makeNode({
			meta: "test",
			args: [{ name: "out", type: "path", default: "./dist" }],
		});
		const result = parseArgs(cmd, []);
		expect((result.args as Record<string, unknown>).out).toBe(`${process.cwd()}/dist`);
	});

	it("validates a non-parse `default` against `choices` when present", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				mode: {
					type: "string",
					choices: ["a", "b"] as const,
					default: "z",
				},
			},
		});
		let err: unknown;
		try {
			parseArgs(cmd, []);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(CrustError);
		expect((err as Error).message).toMatch(/Invalid value "z" for --mode/);
	});

	it("validates a parse `default` against `choices` before running parse", () => {
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
					default: "3",
				},
			},
		});
		expect(() => parseArgs(cmd, [])).toThrow(CrustError);
		expect(parseCalled).toBe(false);
	});

	it("accepts a default that is in the choices list (no false positive)", () => {
		const cmd = makeNode({
			meta: "test",
			flags: {
				mode: {
					type: "string",
					choices: ["a", "b"] as const,
					default: "a",
				},
			},
		});
		const result = parseArgs(cmd, []);
		expect(result.flags.mode).toBe("a");
	});
});
