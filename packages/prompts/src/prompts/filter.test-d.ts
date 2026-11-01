import { filter } from "./filter.ts";
import type { Equal, Expect } from "./test-helpers.ts";

// Compile-time regression checks; intentionally never invoked.
async function _filterTypeInferenceTests() {
	const pick = await filter({ message: "?", choices: ["prettier", "eslint"] });
	type _PickNarrows = Expect<Equal<typeof pick, "prettier" | "eslint">>;

	const widened: string[] = ["a", "b"];
	const loose = await filter({ message: "?", choices: widened });
	type _LooseIsString = Expect<Equal<typeof loose, string>>;

	// @ts-expect-error "biome" is not one of the literal choices
	void filter({ message: "?", choices: ["prettier", "eslint"], default: "biome" });
	const looseDefault = await filter({ message: "?", choices: widened, default: "c" });
	type _LooseDefaultIsString = Expect<Equal<typeof looseDefault, string>>;
}
