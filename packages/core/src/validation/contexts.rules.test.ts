import { describe, expect, it } from "bun:test";

import type { ContextInstance } from "../api/context.ts";
import { definitionProvenance, duplicateContext } from "./contexts.rules.ts";

function context(name: string): ContextInstance {
	return { kind: "context", name, ownedFlags: {}, setup: () => undefined };
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
});
