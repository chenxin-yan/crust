import type { Equal, Expect } from "../../tests/helpers.ts";
import { createCommandNode } from "../command/node.ts";
import type { FlagsDef, InferArgValue, InferFlags, RawArgValue } from "../types.ts";
import { parseArgs, parseFlagValues } from "./parser.ts";

function _rawRequiredVariadic() {
	const command = {
		...createCommandNode("raw"),
		args: [{ name: "files", type: "string", required: true, variadic: true }] as const,
	};
	type Def = (typeof command.args)[0];
	type _raw = Expect<Equal<RawArgValue<Def>, string[] | undefined>>;
	type _validated = Expect<Equal<InferArgValue<Def>, [string, ...string[]]>>;
	const parsed = parseArgs(command, []);
	if (parsed.args.files) {
		// @ts-expect-error -- syntax parsing has not established requiredness
		const first: string = parsed.args.files[0];
		void first;
	}
}

async function _parseFlagValuesKeepsInlineChoices() {
	const flags = await parseFlagValues(
		{ level: { type: "string", choices: ["debug", "info"], env: { name: "LEVEL" } } },
		{},
	);
	type _literal = Expect<Equal<typeof flags.level, "debug" | "info" | undefined>>;

	const widened: FlagsDef = { level: { type: "string", choices: ["debug", "info"] } };
	const loose = await parseFlagValues(widened, {});
	type _widened = Expect<Equal<typeof loose, InferFlags<FlagsDef>>>;
}
