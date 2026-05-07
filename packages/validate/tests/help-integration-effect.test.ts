import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Crust } from "@crustjs/core";
import { helpPlugin, renderHelp } from "@crustjs/plugins";
import * as Schema from "effect/Schema";
import {
	commandValidator,
	arg as rootArg,
	flag as rootFlag,
} from "../src/index.ts";
import type { ArgOptions, FlagOptions } from "../src/schema-types.ts";
import type { StandardSchema } from "../src/types.ts";

// Wrap raw Effect schemas via `Schema.standardSchemaV1(...)` once per call —
// the previously deprecated `/effect` subpath shim was removed in 0.2.0.
function toStandard<A, I>(s: Schema.Schema<A, I, never>): StandardSchema<I, A> {
	return Schema.standardSchemaV1(s) as unknown as StandardSchema<I, A>;
}
function arg<Name extends string, A, I>(
	name: Name,
	schema: Schema.Schema<A, I, never>,
	options?: Omit<ArgOptions, "variadic">,
) {
	return rootArg(name, toStandard(schema), options);
}
function flag<
	A,
	I,
	const Short extends string | undefined = undefined,
	const Aliases extends readonly string[] | undefined = undefined,
	const Inherit extends true | undefined = undefined,
>(
	schema: Schema.Schema<A, I, never>,
	options?: FlagOptions & {
		short?: Short;
		aliases?: Aliases;
		inherit?: Inherit;
	},
) {
	return rootFlag(toStandard(schema), options);
}

let stdoutChunks: string[];
let originalLog: typeof console.log;

beforeEach(() => {
	stdoutChunks = [];
	originalLog = console.log;
	console.log = (...args: unknown[]) => {
		stdoutChunks.push(args.map((arg) => String(arg)).join(" "));
	};
});

afterEach(() => {
	console.log = originalLog;
	process.exitCode = 0;
});

function getStdout(): string {
	return stdoutChunks.join("\n");
}

function stripAnsi(text: string): string {
	return Bun.stripANSI(text);
}

describe("help plugin integration with Crust builder + commandValidator", () => {
	it("renders help for a flags-only schema-first command", async () => {
		const app = new Crust("serve")
			.meta({ description: "Start dev server" })
			.flags({
				verbose: flag(
					Schema.UndefinedOr(
						Schema.Boolean.annotations({
							description: "Enable verbose logging",
						}),
					),
					{ short: "v" },
				),
			})
			.run(commandValidator(() => {}))
			.use(helpPlugin());

		await app.execute({ argv: ["--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("serve - Start dev server");
		expect(output).toContain("USAGE:");
		expect(output).toContain("serve [options]");
		expect(output).toContain("OPTIONS:");
		expect(output).toContain("-v, --verbose, --no-verbose");
		expect(output).toContain("Enable verbose logging");
		expect(output).toContain("-h, --help");
	});

	it("renders args and options sections from generated definitions", () => {
		const app = new Crust("build")
			.args([
				arg("entry", Schema.String.annotations({ description: "Entry file" })),
				arg(
					"target",
					Schema.UndefinedOr(
						Schema.String.annotations({ description: "Build target" }),
					),
				),
			])
			.flags({
				outDir: flag(
					Schema.String.annotations({ description: "Output directory" }),
					{ short: "o" },
				),
			});

		const output = stripAnsi(renderHelp(app._node));
		expect(output).toContain("build <entry> [target] [options]");
		expect(output).toContain("ARGS:");
		expect(output).toContain("<entry>");
		expect(output).toContain("Entry file");
		expect(output).toContain("[target]");
		expect(output).toContain("Build target");
		expect(output).toContain("OPTIONS:");
		expect(output).toContain("-o, --outDir");
	});

	it("runs command with both args and flags through execute", async () => {
		const received: { args: unknown; flags: unknown }[] = [];

		const app = new Crust("build")
			.args([
				arg("entry", Schema.String.annotations({ description: "Entry file" })),
				arg(
					"target",
					Schema.UndefinedOr(
						Schema.String.annotations({ description: "Build target" }),
					),
				),
			])
			.flags({
				outDir: flag(
					Schema.String.annotations({ description: "Output directory" }),
					{ short: "o" },
				),
			})
			.run(
				commandValidator(({ args, flags }) => {
					received.push({ args, flags });
				}),
			)
			.use(helpPlugin());

		await app.execute({ argv: ["index.ts", "es2022", "-o", "dist"] });

		expect(received).toHaveLength(1);
		expect(received[0]?.args).toEqual({
			entry: "index.ts",
			target: "es2022",
		});
		expect(received[0]?.flags).toEqual({ outDir: "dist" });
	});

	it("extracts description from schema annotations", () => {
		const app = new Crust("app").flags({
			port: flag(
				Schema.Number.annotations({ description: "Schema description" }),
			),
		});

		const output = stripAnsi(renderHelp(app._node));
		expect(output).toContain("Schema description");
	});

	it("resolves description through wrappers like UndefinedOr", () => {
		const app = new Crust("app").flags({
			port: flag(
				Schema.UndefinedOr(
					Schema.Number.annotations({ description: "Port number" }),
				),
			),
		});

		const output = stripAnsi(renderHelp(app._node));
		expect(output).toContain("Port number");
	});
});
