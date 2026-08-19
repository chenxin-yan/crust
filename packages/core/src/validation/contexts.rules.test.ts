import { describe, expect, it } from "bun:test";

import { type ContextInstance, defineContext } from "../api/context.ts";
import {
	definitionProvenance,
	duplicateContext,
	missingDependency,
	usesProvenance,
} from "./contexts.rules.ts";

function context(name: string): ContextInstance {
	return {
		kind: "context",
		name,
		ownedFlags: {},
		uses: [],
		setup: () => undefined,
	};
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

	it("rejects uses entries that are not Context factories", () => {
		const db = defineContext("db", () => ({}));
		expect(() => usesProvenance('Context "service"', "context", [db])).not.toThrow();
		expect(() => usesProvenance('Context "service"', "context", [42 as never])).toThrow(
			'Context "service" uses entries must be Context factories returned by defineContext()',
		);
		expect(() => usesProvenance('Context "service"', "context", [db() as never])).toThrow(
			/must be Context factories/,
		);
	});
});
