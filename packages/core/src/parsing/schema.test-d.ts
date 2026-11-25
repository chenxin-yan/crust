import type { StandardSchema } from "@crustjs/utils/schema";
import { z } from "zod";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineFlag } from "../api/flags.ts";
import { Crust } from "../command/crust.ts";
import type { LocalValueBrand } from "../validation/shared.ts";

declare function port(): StandardSchema<string | undefined, number>;

// Compile-time regression checks; intentionally never invoked.
// the schema output type reaches the Command Action
function _typecheckTheSchemaOutputTypeReachesTheCommandAction() {
	new Crust("cli")
		.args({ name: "port", schema: port() })
		.flags({ tag: { type: "string", schema: port() } })
		.action((_ctx) => {
			type _argOutput = Expect<Equal<(typeof _ctx.args)["port"], number>>;
			type _flagOutput = Expect<Equal<(typeof _ctx.flags)["tag"], number>>;
		});
}

// a schema must accept a value the parser hands it: absence is the schema's to reject, and a
// narrower input (an enum, a literal) is validation, but its input must overlap the present
// token: `string`, `boolean`, or an array of them for multiple and variadic definitions
function _typecheckSchemaInputAcceptsTheParserValue() {
	const stringToNumber = z.string().transform((value) => value.length);
	new Crust("cli")
		.args(
			{ name: "count", schema: z.coerce.number() },
			{ name: "files", variadic: true, schema: z.array(z.string()) },
		)
		.flags({
			n: { type: "string", schema: z.coerce.number().optional() },
			len: { type: "string", schema: stringToNumber, env: { name: "LEN" } },
			on: { type: "boolean", schema: z.boolean().optional() },
			yes: { type: "boolean", schema: z.literal(true).optional() },
			level: { type: "string", schema: z.enum(["low", "high"]) },
			levels: { type: "string", multiple: true, schema: z.array(z.enum(["low", "high"])) },
			pair: { type: "string", multiple: true, schema: z.tuple([z.coerce.number()], z.string()) },
			tag: { type: "string", multiple: true, schema: z.array(z.string()).optional() },
			port: { type: "string", schema: port() },
		});

	// a fixed-length tuple overlaps the token array when every position accepts a token
	const coercedPair = z.tuple([z.coerce.number(), z.coerce.number()]);
	const mixedPair = z.tuple([z.union([z.string(), z.number()]), z.enum(["a", "b"])]);
	new Crust("cli").args({ name: "pair", variadic: true, schema: coercedPair }).flags({
		pair: { type: "string", multiple: true, schema: coercedPair },
		mixed: { type: "string", multiple: true, schema: mixedPair },
		switches: { type: "boolean", multiple: true, schema: z.tuple([z.boolean(), z.literal(true)]) },
	});
	new Crust("cli").args({ name: "mixed", variadic: true, schema: mixedPair });
	// every variadic mode hands its schema string[]
	new Crust("cli").args({ name: "command", variadic: "passthrough", schema: z.array(z.string()) });
	new Crust("cli").args({
		name: "extra",
		variadic: "afterDoubleDash",
		schema: z.array(z.string()),
	});

	// @ts-expect-error -- receives a string token
	new Crust("cli").args({ name: "n", schema: z.number() });
	// @ts-expect-error -- a variadic receives string[]
	new Crust("cli").args({ name: "files", variadic: true, schema: z.string().optional() });
	// @ts-expect-error -- a passthrough argument receives string[]
	new Crust("cli").args({ name: "command", variadic: "passthrough", schema: z.string() });
	// @ts-expect-error -- an "afterDoubleDash" argument receives string[]
	new Crust("cli").args({ name: "extra", variadic: "afterDoubleDash", schema: z.string() });
	new Crust("cli").flags({
		// @ts-expect-error -- forgot z.coerce: receives a string
		n: { type: "string", schema: z.number().optional() },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- an env-sourced string flag still receives a string
		n: { type: "string", env: { name: "N" }, schema: z.number() },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- a boolean flag receives a boolean
		on: { type: "boolean", schema: z.string().optional() },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- z.stringbool() parses strings, but a boolean flag hands it a boolean
		on: { type: "boolean", schema: z.stringbool() },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- a multiple flag receives string[]
		tag: { type: "string", multiple: true, schema: z.string().optional() },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- a tuple position must accept a string token
		pair: { type: "string", multiple: true, schema: z.tuple([z.number()]) },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- every tuple position must accept a string token
		pair: { type: "string", multiple: true, schema: z.tuple([z.coerce.number(), z.number()]) },
	});
	// @ts-expect-error -- a variadic tuple position must accept a string token
	new Crust("cli").args({
		name: "pair",
		variadic: true,
		schema: z.tuple([z.string(), z.number()]),
	});
	new Crust("cli").flags({
		// @ts-expect-error -- a boolean tuple position must accept a boolean token
		on: { type: "boolean", multiple: true, schema: z.tuple([z.string()]) },
	});
	// @ts-expect-error -- reusable definitions are checked too
	defineFlag({ type: "string", schema: z.number() });

	type Message = LocalValueBrand<{ type: "string"; schema: z.ZodNumber }>["FIX_SCHEMA_INPUT"];
	type _message = Expect<
		Equal<Message, "schema input must accept string; coerce it, e.g. z.coerce.number()">
	>;
}

// a json flag hands its schema the parsed JSON value: its input must accept JSON data, and
// run() input takes the schema input while the action sees the schema output
function _typecheckJsonFlagSchemaInputAcceptsJsonData() {
	const user = z.object({
		name: z.string(),
		role: z.enum(["admin", "member"]).optional(),
		meta: z.object({ tags: z.array(z.string()), extra: z.unknown() }).optional(),
	});
	const app = new Crust("cli")
		.flags({
			body: { type: "json", schema: user },
			any: { type: "json", schema: z.unknown() },
			list: { type: "json", schema: z.array(z.number()), env: { name: "LIST" } },
			either: { type: "json", schema: z.union([z.string(), z.date()]) },
			record: { type: "json", schema: z.record(z.string(), z.unknown()) },
			rest: { type: "json", schema: z.tuple([z.string()], z.date()) },
		})
		.action((_ctx) => {
			type _flagOutput = Expect<Equal<(typeof _ctx.flags)["body"], z.output<typeof user>>>;
		});
	void app.run([], { flags: { body: { name: "a", role: "admin" }, list: [1, 2] } });
	// @ts-expect-error -- run() takes the schema input
	void app.run([], { flags: { body: { role: "owner" } } });

	new Crust("cli").flags({
		// @ts-expect-error -- a Date is not JSON data
		when: { type: "json", schema: z.date() },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- a bigint is not JSON data
		big: { type: "json", schema: z.bigint() },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- a required Date property accepts no JSON object
		body: { type: "json", schema: z.object({ at: z.date() }) },
	});
	const key: unique symbol = Symbol("key");
	new Crust("cli").flags({
		// @ts-expect-error -- JSON has no symbol keys, so no JSON object has this required one
		keyed: { type: "json", schema: {} as StandardSchema<{ [key]: string }> },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- every tuple, whatever its rest, starts with a Date
		rest: { type: "json", schema: z.tuple([z.date()], z.string()) },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- a string flag hands its schema a string, never an object
		body: { type: "string", schema: user },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- a json schema flag takes one occurrence
		bodies: { type: "json", multiple: true, schema: z.array(user) },
	});
	// @ts-expect-error -- reusable definitions are checked too
	defineFlag({ type: "json", schema: z.date() });

	type Message = LocalValueBrand<{ type: "json"; schema: z.ZodDate }>["FIX_SCHEMA_INPUT"];
	type _message = Expect<Equal<Message, "schema input must accept JSON data">>;
}

// a recursive input type accepts JSON when its finite values do
function _typecheckJsonFlagRecursiveSchemaInput() {
	interface Link {
		value: string;
		next: Link | null;
	}
	const link: z.ZodType<Link, Link> = z.object({
		value: z.string(),
		next: z.lazy(() => link).nullable(),
	});
	interface Even {
		odd: Odd | null;
	}
	interface Odd {
		even: Even;
	}
	const even: z.ZodType<Even, Even> = z.object({ odd: z.lazy(() => odd).nullable() });
	const odd: z.ZodType<Odd, Odd> = z.object({ even: z.lazy(() => even) });
	interface Tree {
		children: Tree[];
	}
	const tree: z.ZodType<Tree, Tree> = z.object({ children: z.array(z.lazy(() => tree)) });

	new Crust("cli").flags({
		link: { type: "json", schema: link },
		even: { type: "json", schema: even },
		odd: { type: "json", schema: odd },
		tree: { type: "json", schema: tree },
	});

	interface Loop {
		next: Loop;
	}
	const loop: z.ZodType<Loop, Loop> = z.object({ next: z.lazy(() => loop) });
	new Crust("cli").flags({
		// @ts-expect-error -- every Loop holds another, so no finite value exists
		loop: { type: "json", schema: loop },
	});

	// Each level is a new type, so the check gives up at its depth bound and leaves it to runtime.
	interface Nest<T> {
		value: T;
		next: Nest<T[]> | null;
	}
	defineFlag({ type: "json", schema: {} as StandardSchema<Nest<string>, Nest<string>> });
}

// a helper generic over the whole schema leaves the input unknown to the check and cannot
// compile; one that names the input and stays generic over the output does
function _typecheckAHelperNamesTheSchemaInput() {
	const stringFlag = <Out>(schema: StandardSchema<string | undefined, Out>) =>
		defineFlag({ type: "string", schema });
	const anyArg = <Out>(schema: StandardSchema<unknown, Out>) =>
		new Crust("cli").args({ name: "port", schema });
	const stored = z.coerce.number().int();

	new Crust("cli")
		.flags({ size: stringFlag(z.string().transform((value) => value.length)) })
		.action((_ctx) => {
			type _flagOutput = Expect<Equal<(typeof _ctx.flags)["size"], number>>;
		});
	anyArg(stored).action((_ctx) => {
		type _argOutput = Expect<Equal<(typeof _ctx.args)["port"], number>>;
	});
	// @ts-expect-error -- an `unknown` input does not fit `string | undefined`
	stringFlag(stored);
}
