import { describe, expect, it } from "bun:test";

import { type ContextInstance, defineContext } from "../api/context.ts";
import { definitionProvenance, duplicateContext, missingDependency } from "./contexts.rules.ts";

function context(name: string): ContextInstance {
	return { kind: "context", name, ownedFlags: {}, uses: [], setup: () => undefined };
}

describe("context runtime rules", () => {
	it("rejects non-Context values and duplicate names", () => {
		expect(() => definitionProvenance(null as never)).toThrow(
			/provide\(\) requires Context instances/,
		);
		expect(() =>
			duplicateContext(context("db"), [context("db")], 'the "cli" command path'),
		).toThrow(/Context "db" is already provided on the "cli" command path/);
	});

	it("rejects a declared dependency absent from the composition site", () => {
		const db = defineContext("db", () => ({}));
		expect(() => missingDependency('Context "service"', [db], new Set(), "the path")).toThrow(
			'Context "service" uses Context "db" which is not provided on the path',
		);
	});
});
