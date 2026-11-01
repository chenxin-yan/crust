import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import { Crust, defineCommand } from "./crust.ts";

// Compile-time regression checks; intentionally never invoked.
// keeps transitive Context dependency closures at constant depth
function _typecheckKeepsTransitiveContextDependencyClosuresAtConstantDepth() {
	const d1 = defineContext("d1").setup(() => 1);
	const d2 = defineContext("d2")
		.use(d1)
		.setup(() => 2);
	const d3 = defineContext("d3")
		.use(d2)
		.setup(() => 3);
	const d4 = defineContext("d4")
		.use(d3)
		.setup(() => 4);
	const d5 = defineContext("d5")
		.use(d4)
		.setup(() => 5);
	const d6 = defineContext("d6")
		.use(d5)
		.setup(() => 6);
	const d7 = defineContext("d7")
		.use(d6)
		.setup(() => 7);
	const d8 = defineContext("d8")
		.use(d7)
		.setup(() => 8);
	new Crust("deep")
		.provide(d1())
		.provide(d2())
		.provide(d3())
		.provide(d4())
		.provide(d5())
		.provide(d6())
		.provide(d7())
		.provide(d8());
}

// 44+ definitions in one `.add()` call must not hit TS2589 (excessively deep instantiation)
const sixtyDefinitions = [
	defineCommand("c0", (command) => command),
	defineCommand("c1", (command) => command),
	defineCommand("c2", (command) => command),
	defineCommand("c3", (command) => command),
	defineCommand("c4", (command) => command),
	defineCommand("c5", (command) => command),
	defineCommand("c6", (command) => command),
	defineCommand("c7", (command) => command),
	defineCommand("c8", (command) => command),
	defineCommand("c9", (command) => command),
	defineCommand("c10", (command) => command),
	defineCommand("c11", (command) => command),
	defineCommand("c12", (command) => command),
	defineCommand("c13", (command) => command),
	defineCommand("c14", (command) => command),
	defineCommand("c15", (command) => command),
	defineCommand("c16", (command) => command),
	defineCommand("c17", (command) => command),
	defineCommand("c18", (command) => command),
	defineCommand("c19", (command) => command),
	defineCommand("c20", (command) => command),
	defineCommand("c21", (command) => command),
	defineCommand("c22", (command) => command),
	defineCommand("c23", (command) => command),
	defineCommand("c24", (command) => command),
	defineCommand("c25", (command) => command),
	defineCommand("c26", (command) => command),
	defineCommand("c27", (command) => command),
	defineCommand("c28", (command) => command),
	defineCommand("c29", (command) => command),
	defineCommand("c30", (command) => command),
	defineCommand("c31", (command) => command),
	defineCommand("c32", (command) => command),
	defineCommand("c33", (command) => command),
	defineCommand("c34", (command) => command),
	defineCommand("c35", (command) => command),
	defineCommand("c36", (command) => command),
	defineCommand("c37", (command) => command),
	defineCommand("c38", (command) => command),
	defineCommand("c39", (command) => command),
	defineCommand("c40", (command) => command),
	defineCommand("c41", (command) => command),
	defineCommand("c42", (command) => command),
	defineCommand("c43", (command) => command),
	defineCommand("c44", (command) => command),
	defineCommand("c45", (command) => command),
	defineCommand("c46", (command) => command),
	defineCommand("c47", (command) => command),
	defineCommand("c48", (command) => command),
	defineCommand("c49", (command) => command),
	defineCommand("c50", (command) => command),
	defineCommand("c51", (command) => command),
	defineCommand("c52", (command) => command),
	defineCommand("c53", (command) => command),
	defineCommand("c54", (command) => command),
	defineCommand("c55", (command) => command),
	defineCommand("c56", (command) => command),
	defineCommand("c57", (command) => command),
	defineCommand("c58", (command) => command),
	defineCommand("c59", (command) => command),
] as const;
function _typecheckAddsSixtyDefinitionsInOneCall() {
	const app = new Crust("wide").add(...sixtyDefinitions);
	type _last = Expect<
		Equal<"c59" extends keyof (typeof app)["_types"]["tree"] ? true : false, true>
	>;
	defineExtension(defineExtensionId("wide")).add(...sixtyDefinitions);
}
