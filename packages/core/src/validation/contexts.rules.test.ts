import { describe, expect, it } from "bun:test";

import type { ContextInstance } from "../api/context.ts";
import {
	contextCycle,
	definitionProvenance,
	duplicateContext,
	missingContextDependency,
} from "./contexts.rules.ts";

function context(name: string, requiredCtx: string[] = []): ContextInstance {
	return { kind: "context", name, requiredCtx, ownedFlags: {}, setup: () => undefined };
}

describe("context runtime rules", () => {
	it("rejects non-Context values and duplicate names", () => {
		expect(() => definitionProvenance(null as never)).toThrow(
			/provide\(\) requires Context instances/,
		);
		expect(() => duplicateContext(context("db"), [context("db")])).toThrow(
			/Context "db" is already provided/,
		);
	});

	it("rejects missing and cyclic dependencies", () => {
		expect(() => missingContextDependency([context("app", ["db"])], 'Command "cli"')).toThrow(
			/requires Context "db"/,
		);
		expect(() => contextCycle([context("a", ["b"]), context("b", ["a"])], 'Command "cli"')).toThrow(
			/form a dependency cycle/,
		);
	});
});
