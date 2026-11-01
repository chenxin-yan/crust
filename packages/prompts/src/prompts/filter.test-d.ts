import { filter } from "./filter.ts";
import type { Equal, Expect } from "./test-helpers.ts";

// Compile-time regression checks; intentionally never invoked.
async function _filterTypeInferenceTests() {
	const pick = await filter({ message: "?", choices: ["prettier", "eslint"] });
	type _PickNarrows = Expect<Equal<typeof pick, "prettier" | "eslint">>;

	const widened: string[] = ["a", "b"];
	const loose = await filter({ message: "?", choices: widened });
	type _LooseIsString = Expect<Equal<typeof loose, string>>;
	const explicitUnion = await filter<"dev" | "prod">({
		choices: [{ label: "Development", value: "dev" }, "prod"],
	});
	type _ExplicitUnionIsPreserved = Expect<Equal<typeof explicitUnion, "dev" | "prod">>;

	const viaGenericChoices = <C extends readonly string[]>(choices: C) => filter({ choices });
	type _GenericChoicesReturnString = Expect<
		Equal<ReturnType<typeof viaGenericChoices>, Promise<string>>
	>;
	const viaGenericObjects = <C extends readonly { label: string; value: number }[]>(choices: C) =>
		filter({ choices });
	type _GenericObjectsReturnNumber = Expect<
		Equal<ReturnType<typeof viaGenericObjects>, Promise<number>>
	>;

	// @ts-expect-error "biome" is not one of the literal choices
	void filter({ message: "?", choices: ["prettier", "eslint"], default: "biome" });
	const looseDefault = await filter({ message: "?", choices: widened, default: "c" });
	type _LooseDefaultIsString = Expect<Equal<typeof looseDefault, string>>;
}
