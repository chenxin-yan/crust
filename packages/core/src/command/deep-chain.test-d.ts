import { defineContext } from "../api/context.ts";
import { Crust } from "./crust.ts";

// Compile-time regression checks; intentionally never invoked.
// keeps transitive Context dependency closures at constant depth
function _typecheckKeepsTransitiveContextDependencyClosuresAtConstantDepth() {
	const d1 = defineContext("d1", () => 1);
	const d2 = defineContext("d2", { uses: [d1] }, () => 2);
	const d3 = defineContext("d3", { uses: [d2] }, () => 3);
	const d4 = defineContext("d4", { uses: [d3] }, () => 4);
	const d5 = defineContext("d5", { uses: [d4] }, () => 5);
	const d6 = defineContext("d6", { uses: [d5] }, () => 6);
	const d7 = defineContext("d7", { uses: [d6] }, () => 7);
	const d8 = defineContext("d8", { uses: [d7] }, () => 8);
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
