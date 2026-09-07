import { Crust } from "../command/crust.ts";

// Compile-time regression checks; intentionally never invoked.
// rejects invalid choice defaults and reserved spellings at the builder call
function _typecheckRejectsInvalidChoiceDefaultsAndReservedSpellingsAtTheBuilderCall() {
	// @ts-expect-error -- default falls outside the literal choices
	new Crust("cli").flags({ name: "mode", type: "string", choices: ["a", "b"], default: "z" });
	// @ts-expect-error -- __proto__ would mutate the plain-object flag registry
	new Crust("cli").flags({ name: "__proto__", type: "boolean" });
	// @ts-expect-error -- aliases share the same reserved spelling rule
	new Crust("cli").flags({ name: "safe", type: "boolean", aliases: ["__proto__"] });
}

// rejects defaults outside literal choices at the builder call
function _typecheckRejectsDefaultsOutsideLiteralChoicesAtTheBuilderCall() {
	// @ts-expect-error -- default falls outside the literal choices
	new Crust("cli").args({ name: "mode", type: "string", choices: ["a", "b"], default: "z" });
}
