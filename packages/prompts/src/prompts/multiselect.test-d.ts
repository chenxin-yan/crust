import { multiselect } from "./multiselect.ts";
import type { Equal, Expect } from "./test-helpers.ts";

// Compile-time regression checks; intentionally never invoked.
async function _multiselectTypeInferenceTests() {
	const tags = await multiselect({ message: "?", choices: ["a", "b"] });
	type _TagsNarrow = Expect<Equal<typeof tags, ("a" | "b")[]>>;

	const ports = await multiselect({
		message: "?",
		choices: [
			{ label: "HTTP", value: 80 },
			{ label: "HTTPS", value: 443 },
		],
	});
	type _PortsNarrow = Expect<Equal<typeof ports, (80 | 443)[]>>;

	const widened: string[] = ["a", "b"];
	const loose = await multiselect({ message: "?", choices: widened });
	type _LooseIsStrings = Expect<Equal<typeof loose, string[]>>;
}
