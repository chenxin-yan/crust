import type { DocumentationArg, DocumentationFlag } from "./documentation.ts";

{
	// models built by hand before `sensitive` existed still type-check
	const arg: DocumentationArg = { name: "file", token: "[file]", required: false, variadic: false };
	const flag: DocumentationFlag = {
		name: "out",
		spellings: ["--out"],
		aliases: [],
		negatable: false,
		type: "string",
		required: false,
		multiple: false,
	};
	void [arg, flag];
}
