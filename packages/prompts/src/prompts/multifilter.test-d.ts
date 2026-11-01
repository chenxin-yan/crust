import { multifilter } from "./multifilter.ts";
import type { Equal, Expect } from "./test-helpers.ts";

// Compile-time regression checks; intentionally never invoked.
async function _multifilterTypeInferenceTests() {
	const picks = await multifilter({ message: "?", choices: ["a", "b"] });
	type _PicksNarrow = Expect<Equal<typeof picks, ("a" | "b")[]>>;

	const widened: string[] = ["a", "b"];
	const loose = await multifilter({ message: "?", choices: widened });
	type _LooseIsStrings = Expect<Equal<typeof loose, string[]>>;
	const explicitUnion = await multifilter<"dev" | "prod">({
		choices: [{ label: "Development", value: "dev" }, "prod"],
	});
	type _ExplicitUnionIsPreserved = Expect<Equal<typeof explicitUnion, ("dev" | "prod")[]>>;

	const viaGenericChoices = <C extends readonly string[]>(choices: C) => multifilter({ choices });
	type _GenericChoicesReturnStrings = Expect<
		Equal<ReturnType<typeof viaGenericChoices>, Promise<string[]>>
	>;
	const viaGenericObjects = <C extends readonly { label: string; value: number }[]>(choices: C) =>
		multifilter({ choices });
	type _GenericObjectsReturnNumbers = Expect<
		Equal<ReturnType<typeof viaGenericObjects>, Promise<number[]>>
	>;

	// @ts-expect-error "c" is not one of the literal choices
	void multifilter({ message: "?", choices: ["a", "b"], default: ["c"] });
	const looseDefault = await multifilter({ message: "?", choices: widened, default: ["c"] });
	type _LooseDefaultIsStrings = Expect<Equal<typeof looseDefault, string[]>>;
}
