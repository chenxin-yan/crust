import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineFlag } from "../api/flags.ts";
import { defineExtensionId } from "../identity.ts";
import type { FlagDef } from "../types.ts";
import type { IsUnion } from "../validation/shared.ts";
import { Crust, defineCommand } from "./crust.ts";

// Compile-time checks for the record form of `.flags()`; never invoked.
// Each `@ts-expect-error` sits on the line of the literal that carries the error.

function _inference() {
	const format = defineFlag({ type: "string", choices: ["json", "yaml"], default: "json" });
	const deploy = defineCommand("deploy", (command) =>
		command
			.flags({
				out: { type: "string", short: "o", description: "Output path" },
				"dry-run": { type: "boolean", short: "n" },
				level: { type: "number", default: 1 },
			})
			.flags({ format, output: format })
			.args({ name: "source", type: "string", required: true })
			.action(({ args, flags }) => {
				type _out = Expect<Equal<typeof flags.out, string | undefined>>;
				type _dryRun = Expect<Equal<(typeof flags)["dry-run"], boolean | undefined>>;
				type _level = Expect<Equal<typeof flags.level, number>>;
				type _format = Expect<Equal<typeof flags.format, "json" | "yaml">>;
				type _output = Expect<Equal<typeof flags.output, "json" | "yaml">>;
				type _source = Expect<Equal<typeof args.source, string>>;
			}),
	);
	void new Crust("cli")
		.add(deploy)
		.run(["deploy"], { args: { source: "x" }, flags: { out: "o", format: "yaml" } });
	void new Crust("cli")
		.add(deploy)
		// @ts-expect-error -- typed run() input is checked against the record's choices
		.run(["deploy"], { args: { source: "x" }, flags: { format: "xml" } });

	// Action flags are mutable, though the inferred record is readonly.
	new Crust("cli")
		.flags({ out: { type: "string" }, force: { type: "boolean" } })
		.action(({ flags }) => {
			type _flags = Expect<
				Equal<typeof flags, { out: string | undefined; force: boolean | undefined }>
			>;
		});

	// A one-key record whose key is `name` is an ordinary flag.
	new Crust("cli").flags({ name: { type: "string" } }).action(({ flags }) => {
		type _name = Expect<Equal<typeof flags.name, string | undefined>>;
	});
}

// §5: each diagnostic lands on the offending flag's own literal. Names, spellings and
// collisions are checked when the CLI runs from source and by `crust build`.
function _errorLocality() {
	new Crust("cli").flags({
		out: { type: "string", short: "o" },
		// @ts-expect-error -- default outside choices
		mode: { type: "string", choices: ["a", "b"], default: "c" },
	});
}

// §5: the removed named form is rejected per property and per extra argument.
function _namedFormIsRejected() {
	new Crust("cli").flags({
		// @ts-expect-error -- a string is not a flag definition
		name: "out",
		// @ts-expect-error -- a string is not a flag definition
		type: "string",
	});
	// @ts-expect-error -- one record per call
	new Crust("cli").flags({ out: { type: "string" } }, { force: { type: "boolean" } });
	// @ts-expect-error -- definitions take their name from the key
	defineFlag("out", { type: "string" });
}

// §5/§6: object-literal limits TypeScript itself reports, and the ones it cannot.
function _spreads(dynamic: Record<string, FlagDef>) {
	const shared = { out: { type: "boolean" } } as const;
	new Crust("cli").flags({
		// @ts-expect-error -- TS2783: `out` is overwritten by the spread
		out: { type: "string" },
		...shared,
	});
	// A key after a spread silently replaces the spread's flag (TypeScript limitation).
	new Crust("cli").flags({ ...shared, out: { type: "string" } }).action(({ flags }) => {
		type _out = Expect<Equal<typeof flags.out, string | undefined>>;
	});
	// Literal keys beside a dynamic spread are still checked.
	new Crust("cli").flags({
		...dynamic,
		// @ts-expect-error -- default outside choices
		out: { type: "string", choices: ["a"], default: "b" },
	});
	// A dynamic record is checked at runtime and stays an open view.
	new Crust("cli").flags(dynamic).action(({ flags }) => {
		type _any = Expect<Equal<(typeof flags)["anything"], typeof flags.other>>;
	});
}

function _symbolKeysAreRejected(dynamic: symbol) {
	const hidden: unique symbol = Symbol("hidden");
	new Crust("cli").flags({
		// @ts-expect-error -- `.flags()` reads only string keys, so a symbol key would never become a flag
		[hidden]: { type: "string" },
		out: { type: "string" },
	});
	const definitions = {
		[hidden]: { type: "string", default: "hidden" },
		out: { type: "string" },
	} as const;
	// @ts-expect-error -- a prebuilt record is checked the same way
	new Crust("cli").flags(definitions);
	// @ts-expect-error -- as would a key typed as any symbol
	new Crust("cli").flags({ [dynamic]: { type: "string" } });
}

function _unionDefinitionsCheckEveryBranch(
	asyncParse: { type: "boolean" } | { type: "string"; parse: (raw: string) => Promise<string> },
) {
	// @ts-expect-error -- the string branch's parser is async
	new Crust("cli").flags({ value: asyncParse });
	// @ts-expect-error -- Contexts check every branch too
	defineContext("ctx").flags({ value: asyncParse });
	// @ts-expect-error -- as do Extensions
	defineExtension(defineExtensionId("test:union")).flags({ value: asyncParse });
	new Crust("cli").flags({
		value: {} as { type: "boolean" } | { type: "string"; parse: (raw: string) => string },
	});
}

function _conditionalRecords(definitions: {} | { port: { type: "number"; default: number } }) {
	const extension = defineExtension(defineExtensionId("conditional"))
		.flags(definitions)
		.flags({ quiet: { type: "boolean" } });
	void new Crust("cli").extend(extension).run([], { flags: { port: 3 } });
	const context = defineContext("conditional")
		.flags(definitions)
		.flags({ quiet: { type: "boolean" } })
		.setup(() => undefined);
	const app = new Crust("cli").provide(context());
	type _conditional = Expect<Equal<IsUnion<typeof app._types.flags>, true>>;
	type _port = Expect<
		Equal<
			Extract<typeof app._types.flags, { port: unknown }>["port"],
			{ type: "number"; default: number }
		>
	>;
	// @ts-expect-error A conditional Context retains uncertainty rather than claiming quiet alone.
	void app.run([], { flags: { quiet: true } });
}

// TypeScript adds `missing?: undefined` to each branch of a conditional; those keys must not
// make inference fall back to an open record.
function _inferredConditionalRecords(cond: boolean, maybe: { type: "boolean" } | undefined) {
	const inline = new Crust("cli").flags(
		cond ? { ok: { type: "boolean" } } : { other: { type: "string" } },
	);
	type _inline = Expect<
		Equal<
			typeof inline._types.flags,
			| { readonly ok: { readonly type: "boolean" } }
			| { readonly other: { readonly type: "string" } }
		>
	>;
	const stored = cond ? { a: { type: "boolean" as const } } : { b: { type: "string" as const } };
	const held = new Crust("cli").flags(stored);
	type _held = Expect<
		Equal<typeof held._types.flags, { a: { type: "boolean" } } | { b: { type: "string" } }>
	>;
	// each branch is checked on its own
	new Crust("cli").flags(
		// @ts-expect-error -- default outside choices
		cond ? { ok: { type: "boolean" } } : { bad: { type: "string", choices: ["a"], default: "b" } },
	);
	defineContext("cfg").flags(
		// @ts-expect-error -- Contexts check each branch too
		cond ? { ok: { type: "boolean" } } : { bad: { type: "string", choices: ["a"], default: "b" } },
	);
	defineExtension(defineExtensionId("cfg")).flags(
		// @ts-expect-error -- as do Extensions
		cond ? { ok: { type: "boolean" } } : { bad: { type: "string", choices: ["a"], default: "b" } },
	);
	// an undefined definition is no flag; only an optional key may be absent
	// @ts-expect-error -- FIX_UNDEFINED_FLAG
	new Crust("cli").flags({ x: maybe });
}

function _conditionalNormalization(
	partial:
		| { a: { type: "boolean" }; missing?: undefined }
		| { b: { type: "string"; default: "yes" } },
	all:
		| { a: { type: "boolean" }; missing?: undefined }
		| { b: { type: "string" }; absent?: undefined },
) {
	const app = new Crust("cli").flags(partial).action(({ flags }) => {
		// @ts-expect-error -- the a branch has no b flag
		flags.b.toUpperCase();
	});
	type _partial = Expect<
		Equal<
			typeof app._types.flags,
			{ a: { type: "boolean" } } | { b: { type: "string"; default: "yes" } }
		>
	>;
	defineContext("partial")
		.flags(partial)
		.setup(({ flags }) => {
			// @ts-expect-error -- setup must retain the a branch too
			flags.b.toUpperCase();
		});
	defineExtension(defineExtensionId("partial"))
		.flags(partial)
		.preRun(({ flags }) => {
			// @ts-expect-error -- extension hooks must retain the a branch too
			flags.b.toUpperCase();
		});
	const both = new Crust("cli").flags(all);
	type _all = Expect<
		Equal<typeof both._types.flags, { a: { type: "boolean" } } | { b: { type: "string" } }>
	>;
}

function _optionalDefinitionsStillChecked(required: { a: { type: "boolean" }; b: undefined }) {
	// @ts-expect-error -- required undefined-only keys are not absent placeholders
	new Crust("cli").flags(required);
}

function _contexts() {
	const auth = defineContext("auth")
		.flags({ token: { type: "string", env: { name: "API_TOKEN" } } })
		.flags({ verbose: { type: "boolean", short: "v" } })
		.setup(({ flags }) => {
			type _token = Expect<Equal<typeof flags.token, string | undefined>>;
			type _verbose = Expect<Equal<typeof flags.verbose, boolean | undefined>>;
			return flags.token;
		});
	new Crust("cli").provide(auth()).action(({ flags }) => {
		type _token = Expect<Equal<typeof flags.token, string | undefined>>;
	});
}

function _extensions() {
	const trace = defineExtension(defineExtensionId("test:trace"))
		.flags({
			trace: { type: "boolean" },
			root: { type: "string", recursive: false },
		})
		.preRun(({ flags }) => {
			type _trace = Expect<Equal<typeof flags.trace, boolean | undefined>>;
			type _root = Expect<Equal<typeof flags.root, string | undefined>>;
		});
	const app = new Crust("cli")
		.extend(trace)
		.command("child", (command) => command.action(() => {}));
	void app.run(["child"], { flags: { trace: true } });
	// @ts-expect-error -- `recursive: false` keeps "root" off the child
	void app.run(["child"], { flags: { root: "x" } });
}
