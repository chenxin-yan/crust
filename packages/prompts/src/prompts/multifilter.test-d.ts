import { multifilter } from "./multifilter.ts";
import type { Equal, Expect } from "./test-helpers.ts";

// Compile-time regression checks; intentionally never invoked.
async function _multifilterTypeInferenceTests() {
	const picks = await multifilter({ message: "?", choices: ["a", "b"] });
	type _PicksNarrow = Expect<Equal<typeof picks, ("a" | "b")[]>>;

	const ports = await multifilter({
		message: "?",
		choices: [
			{ label: "HTTP", value: 80 },
			{ label: "HTTPS", value: 443 },
		],
	});
	type _PortsNarrow = Expect<Equal<typeof ports, (80 | 443)[]>>;

	const widened: string[] = ["a", "b"];
	const loose = await multifilter({ message: "?", choices: widened });
	type _LooseIsStrings = Expect<Equal<typeof loose, string[]>>;
}
