import { describe, expect, it } from "bun:test";

import type { FlagsDef } from "../types.ts";
import { schemaExclusivity } from "./args.rules.ts";
import {
	aliasCollision,
	noPrefix,
	nonEmptyName,
	parserType,
	reservedSpelling,
} from "./flags.rules.ts";
import { normalizeFlag } from "./normalize.ts";

describe("aliasCollision", () => {
	it("rejects canonical names that collide with an existing short or alias", () => {
		expect(() =>
			aliasCollision(
				{ name: "v", def: { type: "boolean" } },
				{ verbose: { type: "boolean", short: "v" } },
				'Context "logger"',
			),
		).toThrow(/collides with flag "--verbose"/);
		expect(() =>
			aliasCollision(
				{ name: "out", def: { type: "string" } },
				{ output: { type: "string", aliases: ["out"] } },
				'Context "writer"',
			),
		).toThrow(/collides with flag "--output"/);
	});

	it("rejects incoming short and aliases that collide with existing spellings", () => {
		const existing = {
			verbose: { type: "boolean", short: "v", aliases: ["loud"] },
		} satisfies FlagsDef;
		expect(() =>
			aliasCollision(
				{ name: "version", def: { type: "boolean", short: "v" } },
				existing,
				'Context "release"',
			),
		).toThrow(/spelling "v"/);
		expect(() =>
			aliasCollision(
				{ name: "log", def: { type: "string", aliases: ["loud"] } },
				existing,
				'Context "logger"',
			),
		).toThrow(/spelling "loud"/);
	});

	it('rejects "__proto__" as a flag name or alias', () => {
		expect(() => reservedSpelling("__proto__", { type: "boolean" }, 'Extension "evil"')).toThrow(
			/reserved spelling "__proto__"/,
		);
		expect(() =>
			reservedSpelling("proto", { type: "boolean", aliases: ["__proto__"] }, 'Extension "evil"'),
		).toThrow(/reserved spelling "__proto__"/);
	});

	it("rejects a definition without a non-empty name", () => {
		expect(() => nonEmptyName(undefined as never)).toThrow(/must carry a non-empty name/);
		expect(() => nonEmptyName("")).toThrow(/must carry a non-empty name/);
	});

	it("rejects duplicate spellings within the incoming definition", () => {
		expect(() =>
			aliasCollision(
				{ name: "output", def: { type: "string", short: "o", aliases: ["o"] } },
				{},
				'Context "writer"',
			),
		).toThrow(/repeats spelling "o"/);
	});

	it('rejects "no-" prefixes and missing parser types at the entry gate', () => {
		expect(() => noPrefix("no-cache", { type: "boolean" }, 'Extension "cache" on "root"')).toThrow(
			/Extension "cache" on "root" flag "--no-cache" must not use "no-" prefix/,
		);
		expect(() => parserType("verbose", {} as never, 'Context "logger"')).toThrow(
			/must declare a parser type/,
		);
	});

	it('reports a missing parser type before a "no-" prefixed short alias', () => {
		// Pins entry-gate precedence: name no-prefix -> parser type -> short/alias no-prefix.
		expect(() =>
			normalizeFlag(
				{ name: "cache", def: { type: "bogus", short: "no-c" } as never },
				{},
				new Map(),
				'Command "test"',
			),
		).toThrow(/must declare a parser type/);
	});

	it("rejects mixing a schema with core options at the entry gate", () => {
		expect(() =>
			schemaExclusivity("flag", "port", { type: "string", schema: {}, default: "3000" } as never),
		).toThrow(/mixes core option "default" with a schema/);
	});
});
