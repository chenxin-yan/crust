import type { CommandSectionInput } from "./types.ts";

// Compile-time regression checks; intentionally never invoked.
// requires minted Extension ids in section audiences
function _typecheckRequiresMintedExtensionIdsInSectionAudiences() {
	const invalid: CommandSectionInput = {
		title: "Invalid",
		body: "Invalid",
		// @ts-expect-error section audiences reject raw strings
		only: ["raw"],
	};
	void invalid;
}
