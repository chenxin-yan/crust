import { describe, expect, it } from "bun:test";

import { createCommandNode } from "../command/node.ts";
import { resolveCommand } from "../command/router.ts";
import type { FlagsDef } from "../types.ts";
import { parseArgs } from "./parser.ts";
import { flagSpellings } from "./spellings.ts";

const flags = {
	quiet: { type: "boolean", short: "q", aliases: ["silent"] },
	config: { type: "string", short: "c", aliases: ["config-file"] },
	verbose: { type: "boolean", aliases: ["chatty"], noNegate: true },
} satisfies FlagsDef;

describe("flagSpellings", () => {
	it.each([
		["quiet", "quiet", "canonical"],
		["q", "quiet", "short"],
		["silent", "quiet", "alias"],
		["config-file", "config", "alias"],
	] as const)("maps %s to its canonical flag", (spelling, canonicalName, kind) => {
		expect(flagSpellings(flags).get(spelling)).toMatchObject({ canonicalName, kind });
	});

	it("records negation policy for canonical names and aliases", () => {
		const spellings = flagSpellings(flags);
		expect(spellings.get("quiet")?.negatable).toBe(true);
		expect(spellings.get("silent")?.negatable).toBe(true);
		expect(spellings.get("verbose")?.negatable).toBe(false);
		expect(spellings.get("chatty")?.negatable).toBe(false);
	});

	it("drives parsing and routing for equals values and short bundles", () => {
		const root = createCommandNode("app");
		root.localFlags = flags;
		root.effectiveFlags = flags;
		// Routing only forwards pre-subcommand flags the child can parse, so the
		// child carries the same flags (as Context propagation would).
		const run = createCommandNode("run");
		run.effectiveFlags = flags;
		root.subCommands.run = run;

		expect(resolveCommand(root, ["--config=app.json", "run"])).toMatchObject({
			commandPath: ["app", "run"],
			argv: ["--config=app.json"],
		});
		expect(resolveCommand(root, ["-qcapp.json", "run"])).toMatchObject({
			commandPath: ["app", "run"],
			argv: ["-qcapp.json"],
		});

		expect(parseArgs(root, ["--config=app.json"]).flags.config).toBe("app.json");
		expect(parseArgs(root, ["-qcapp.json"]).flags).toMatchObject({
			quiet: true,
			config: "app.json",
		});
	});

	it("rejects collisions across canonical, short, and alias spellings", () => {
		expect(() =>
			flagSpellings({
				quiet: { type: "boolean", short: "q" },
				query: { type: "string", aliases: ["q"] },
			}),
		).toThrow('Alias collision: "-q" is used by both "--quiet" and "--query"');
	});

	it("enforces the shared shape rulebook on hand-built flag records", () => {
		expect(() => flagSpellings({ proto: { type: "boolean", aliases: ["__proto__"] } })).toThrow(
			/reserved spelling "__proto__"/,
		);
		expect(() => flagSpellings({ output: { type: "string", short: "o", aliases: ["o"] } })).toThrow(
			/repeats spelling "o"/,
		);
	});
});
