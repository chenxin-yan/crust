import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../../tests/helpers.ts";
import type { InferArgValue, InputArgs } from "../types.ts";
import { Crust, type RunInput } from "./crust.ts";

function _positionalPrefixes() {
	const app = new Crust("prefix").args(
		{ name: "source", type: "string", default: "cwd" },
		{ name: "destination", type: "json" },
	);
	type Args = InputArgs<(typeof app)["_types"]["args"]>;
	type Input = RunInput<(typeof app)["_types"]["shape"]>;
	const empty: Args = {};
	const first: Args = { source: "in" };
	const full: Args = { source: "in", destination: { ok: true } };
	// @ts-expect-error -- defaults do not fill a structural positional gap
	const gap: Args = { destination: { ok: true } };
	// @ts-expect-error -- exported run input preserves the prefix relation
	const inputGap: Input = { args: { destination: { ok: true } } };
	void app.run([]);
	void app.run([], { args: full });
	// @ts-expect-error -- direct inferred input cannot skip a defaulted position
	void app.run([], { args: { destination: { ok: true } } });
	const assignedGap = { args: { destination: { ok: true } } };
	// @ts-expect-error -- assigned inputs cannot bypass prefix validation
	void app.run([], assignedGap);
	interface Payload {
		ok: boolean;
	}
	const payload: Payload = { ok: true };
	void app.run([], { args: { source: "in", destination: payload } });
	// @ts-expect-error -- JSON compatibility cannot recombine prefix branches
	void app.run([], { args: { destination: payload } });
	function generic<T extends Payload>(value: T) {
		// @ts-expect-error -- generic JSON data does not prove the missing prefix
		void app.run([], { args: { destination: value } });
	}
	void [empty, first, full, gap, inputGap, generic];
}

function _requiredTrailingPosition() {
	const app = new Crust("required").args(
		{ name: "first", type: "string" },
		{ name: "last", type: "string", required: true },
	);
	void app.run([], { args: { first: "a", last: "b" } });
	// @ts-expect-error -- a required trailing argument requires the whole prefix
	void app.run([], { args: { last: "b" } });
	// @ts-expect-error -- required section cannot be omitted
	void app.run([]);

	const undefinedDefault = new Crust("undefined-default").args({
		name: "required",
		type: "string",
		required: true,
		default: undefined,
	});
	// @ts-expect-error -- an undefined default does not satisfy runtime requiredness
	void undefinedDefault.run([]);
}

function _requiredVariadic() {
	const app = new Crust("many").args({
		name: "files",
		type: "string",
		variadic: true,
		required: true,
	});
	void app.run([], { args: { files: ["one"] } });
	// @ts-expect-error -- required core variadics without defaults are nonempty
	void app.run([], { args: { files: [] } });
	type _defaultOutput = Expect<
		Equal<
			InferArgValue<{
				name: "files";
				type: "string";
				variadic: true;
				required: true;
				default: "fallback";
			}>,
			string[]
		>
	>;
	type SchemaArg = {
		name: "files";
		variadic: true;
		schema: StandardSchema<string[] | undefined, string[]>;
	};
	const schemaInput: InputArgs<readonly [SchemaArg]> = {};
	type _schemaOutput = Expect<Equal<InferArgValue<SchemaArg>, string[]>>;
	void schemaInput;
}

function _requiredJsonVariadic() {
	const app = new Crust("json-many").args({
		name: "items",
		type: "json",
		variadic: true,
		required: true,
	});
	interface Payload {
		ok: boolean;
	}
	const payload: Payload = { ok: true };
	const nonempty: [Payload, ...Payload[]] = [payload];
	void app.run([], { args: { items: [payload] } });
	void app.run([], { args: { items: nonempty } });
	// @ts-expect-error -- JSON compatibility must preserve nonempty occurrences
	void app.run([], { args: { items: [] } });
	const empty = { args: { items: [] } };
	// @ts-expect-error -- assigned inputs cannot bypass nonempty occurrences
	void app.run([], empty);
	const widened: Payload[] = [payload];
	// @ts-expect-error -- a widened array does not prove a first occurrence
	void app.run([], { args: { items: widened } });
	// @ts-expect-error -- a JSON-compatible object is not an occurrence array
	void app.run([], { args: { items: payload } });
	// @ts-expect-error -- exported inputs enforce the same nonempty contract
	const input: InputArgs<(typeof app)["_types"]["args"]> = { items: [] };
	void input;
}

function _thirtyArgumentChain() {
	const app = new Crust("deep")
		.args({ name: "a0", type: "string" })
		.args({ name: "a1", type: "string" })
		.args({ name: "a2", type: "string" })
		.args({ name: "a3", type: "string" })
		.args({ name: "a4", type: "string" })
		.args({ name: "a5", type: "string" })
		.args({ name: "a6", type: "string" })
		.args({ name: "a7", type: "string" })
		.args({ name: "a8", type: "string" })
		.args({ name: "a9", type: "string" })
		.args({ name: "a10", type: "string" })
		.args({ name: "a11", type: "string" })
		.args({ name: "a12", type: "string" })
		.args({ name: "a13", type: "string" })
		.args({ name: "a14", type: "string" })
		.args({ name: "a15", type: "string" })
		.args({ name: "a16", type: "string" })
		.args({ name: "a17", type: "string" })
		.args({ name: "a18", type: "string" })
		.args({ name: "a19", type: "string" })
		.args({ name: "a20", type: "string" })
		.args({ name: "a21", type: "string" })
		.args({ name: "a22", type: "string" })
		.args({ name: "a23", type: "string" })
		.args({ name: "a24", type: "string" })
		.args({ name: "a25", type: "string" })
		.args({ name: "a26", type: "string" })
		.args({ name: "a27", type: "string" })
		.args({ name: "a28", type: "string" })
		.args({ name: "a29", type: "string" })
		.action(() => "done" as const);
	function run(values: {
		[D in (typeof app)["_types"]["args"][number] as D["name"]]: string;
	}) {
		void app.run([], { args: values });
	}
	void run;
	// @ts-expect-error -- a late position still requires every earlier position
	void app.run([], { args: { a29: "last" } });
}

type HundredPositions<Defs extends readonly { name: string; type: "string" }[] = []> =
	Defs["length"] extends 100
		? Defs
		: HundredPositions<readonly [...Defs, { name: `p${Defs["length"]}`; type: "string" }]>;

function _hundredPositionPrefixes(
	app: Crust<{}, HundredPositions>,
	values: { [D in HundredPositions[number] as D["name"]]: string },
) {
	const input: InputArgs<HundredPositions> = values;
	void app.run([], { args: input });
	// @ts-expect-error -- the prefix relation has no small-tuple cutoff
	void app.run([], { args: { p99: "last" } });
}
