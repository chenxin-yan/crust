import { describe, expect, it } from "bun:test";

import { createCommandNode } from "../command/node.ts";
import { resolveCommand } from "../command/router.ts";
import type { FlagsDef } from "../types.ts";
import { normalizeFlag } from "../validation/normalize.ts";
import { parseArgs } from "./parser.ts";
import { addFlagSpellingEntries, type FlagSpelling } from "./spellings.ts";

/** Build a spelling table through the production entry gate. */
function buildSpellings(flagsDef: FlagsDef): Map<string, FlagSpelling> {
	const existing: FlagsDef = {};
	const spellings = new Map<string, FlagSpelling>();
	for (const [name, def] of Object.entries(flagsDef)) {
		normalizeFlag({ name, def }, existing, spellings, `Command "test"`);
		existing[name] = def;
	}
	return spellings;
}

const flags = {
	quiet: { type: "boolean", short: "q", aliases: ["silent"] },
	config: { type: "string", short: "c", aliases: ["config-file"] },
	verbose: { type: "boolean", aliases: ["chatty"], noNegate: true },
} satisfies FlagsDef;

describe("flag spelling table", () => {
	it.each([
		["quiet", "quiet", "canonical"],
		["q", "quiet", "short"],
		["silent", "quiet", "alias"],
		["config-file", "config", "alias"],
	] as const)("maps %s to its canonical flag", (spelling, canonicalName, kind) => {
		expect(buildSpellings(flags).get(spelling)).toMatchObject({ canonicalName, kind });
	});

	it("records negation policy for canonical names and aliases", () => {
		const spellings = buildSpellings(flags);
		expect(spellings.get("quiet")?.negatable).toBe(true);
		expect(spellings.get("silent")?.negatable).toBe(true);
		expect(spellings.get("verbose")?.negatable).toBe(false);
		expect(spellings.get("chatty")?.negatable).toBe(false);
	});

	it("drives parsing and routing for equals values and short bundles", () => {
		const root = createCommandNode("app");
		root.localFlags = flags;
		root.effectiveFlags = flags;
		for (const [name, def] of Object.entries(flags)) {
			addFlagSpellingEntries(root.flagSpellings, name, def);
		}
		// Routing only forwards pre-subcommand flags the child can parse, so the
		// child carries the same flags (as Context propagation would).
		const run = createCommandNode("run");
		run.effectiveFlags = flags;
		for (const [name, def] of Object.entries(flags)) {
			addFlagSpellingEntries(run.flagSpellings, name, def);
		}
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
			buildSpellings({
				quiet: { type: "boolean", short: "q" },
				query: { type: "string", aliases: ["q"] },
			}),
		).toThrow('Command "test" flag "--query" spelling "q" collides with flag "--quiet"');
	});

	it("enforces the shared shape rulebook on hand-built flag records", () => {
		expect(() => buildSpellings({ proto: { type: "boolean", aliases: ["__proto__"] } })).toThrow(
			/reserved spelling "__proto__"/,
		);
		expect(() =>
			buildSpellings({ output: { type: "string", short: "o", aliases: ["o"] } }),
		).toThrow(/repeats spelling "o"/);
	});
});
