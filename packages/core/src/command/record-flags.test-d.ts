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

// §5: each diagnostic lands on the offending flag's own literal.
function _errorLocality() {
	new Crust("cli").flags({
		// @ts-expect-error -- `out` and `open` share the short "o"; both literals carry it
		out: { type: "string", short: "o" },
		// @ts-expect-error -- `out` and `open` share the short "o"; both literals carry it
		open: { type: "boolean", short: "o" },
	});
	new Crust("cli")
		.flags({ out: { type: "string", short: "o" } })
		// @ts-expect-error -- collides with a flag from an earlier call
		.flags({ output: { type: "string", aliases: ["out"] } });
	new Crust("cli").flags({
		// @ts-expect-error -- short flags must be one character
		out: { type: "string", short: "oo" },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- default outside choices
		mode: { type: "string", choices: ["a", "b"], default: "c" },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- names must not start with no-
		"no-cache": { type: "boolean" },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- `__proto__` is reserved
		__proto__: { type: "string" },
	});

	const auth = defineContext("auth")
		.flags({ token: { type: "string", short: "k" } })
		.setup(() => "t");
	defineCommand("login", (command) =>
		command
			.flags({ key: { type: "string", short: "k" } })
			// @ts-expect-error -- the Context's "-k" collides with the record flag's short
			.provide(auth()),
	);
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
		// @ts-expect-error -- short flags must be one character
		out: { type: "string", short: "oo" },
	});
	// A dynamic record is checked at runtime and stays an open view.
	new Crust("cli").flags(dynamic).action(({ flags }) => {
		type _any = Expect<Equal<(typeof flags)["anything"], typeof flags.other>>;
	});
	// After a dynamic record, a later record's literal flags are still checked against each other.
	new Crust("cli").flags(dynamic).flags({
		// @ts-expect-error -- `a` and `b` share the short "x"; both literals carry it
		a: { type: "boolean", short: "x" },
		// @ts-expect-error -- `a` and `b` share the short "x"; both literals carry it
		b: { type: "boolean", short: "x" },
	});
	defineContext("open")
		.flags(dynamic)
		.flags({
			// @ts-expect-error -- `a`'s alias "all" is the name of flag `all`; both literals carry it
			a: { type: "boolean", aliases: ["all"] },
			// @ts-expect-error -- `a`'s alias "all" is the name of flag `all`; both literals carry it
			all: { type: "boolean" },
		});
}

// §6: integer-like names are rejected because JavaScript lists them first.
function _integerLikeNames() {
	new Crust("cli").flags({
		// @ts-expect-error -- integer-like string key
		"2": { type: "string", short: "x" },
		a: { type: "string" },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- integer-like string key
		"10": { type: "boolean" },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- "0" is an array index too
		"0": { type: "boolean" },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- every digit-only name is rejected, as at runtime, even past the array-index range
		"4294967295": { type: "boolean" },
	});
	// Not integer-like: kept in insertion order, so allowed.
	new Crust("cli").flags({
		"01": { type: "boolean" },
		"2fa": { type: "boolean" },
		"1.5": { type: "boolean" },
	});
	// Shorts and aliases are not record keys.
	new Crust("cli").flags({ two: { type: "boolean", short: "2", aliases: ["22"] } });
}

// Builders keep record keys as written, so a number key would escape later collision checks.
function _numberKeysMustBeQuoted() {
	new Crust("cli").flags({
		// @ts-expect-error -- quote the numeric name
		1.5: { type: "boolean" },
		a: { type: "boolean" },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- an integer-like number key is rejected too
		2: { type: "boolean" },
	});
	defineContext("ctx").flags({
		// @ts-expect-error -- Contexts reject number keys
		1.5: { type: "boolean" },
	});
	defineExtension(defineExtensionId("test:number")).flags({
		// @ts-expect-error -- as do Extensions
		1.5: { type: "boolean" },
	});

	// A quoted numeric name keeps its spelling in builder state.
	new Crust("cli")
		.flags({ "1.5": { type: "boolean" } })
		// @ts-expect-error -- collides with the earlier "1.5" flag
		.flags({ "1.5": { type: "boolean" } });
	new Crust("cli")
		.flags({ "1.5": { type: "boolean" }, a: { type: "boolean", aliases: ["bee"] } })
		// @ts-expect-error -- collides with the alias beside the numeric name
		.flags({ bee: { type: "boolean" } });
	const app = new Crust("cli").flags({ "1.5": { type: "boolean" } }).action(({ flags }) => {
		type _numeric = Expect<Equal<(typeof flags)["1.5"], boolean | undefined>>;
	});
	void app.run([], { flags: { "1.5": true } });
}

// Literal keys beside an index signature are checked against each other.
function _literalKeysBesideIndexSignatures(
	numeric: {
		[key: number]: FlagDef;
		a: { type: "boolean"; aliases: readonly ["b"] };
		b: { type: "boolean" };
	},
	string: {
		[key: string]: FlagDef;
		a: { type: "boolean"; aliases: readonly ["x"] };
		b: { type: "boolean"; aliases: readonly ["x"] };
	},
	distinct: {
		[key: number]: FlagDef;
		a: { type: "boolean"; aliases: readonly ["x"] };
		b: { type: "boolean"; aliases: readonly ["y"] };
	},
) {
	// @ts-expect-error -- `a`'s alias collides with `b`
	new Crust("cli").flags(numeric);
	// @ts-expect-error -- `a` and `b` share an alias
	new Crust("cli").flags(string);
	new Crust("cli").flags(distinct);
}

// The parser adds a spelling's dashes and splits `--a=b` at `=`, so these never match argv.
function _spellingShape(name: string, alias: string, short: string) {
	new Crust("cli").flags({
		// @ts-expect-error -- "=" in a name
		"a=b": { type: "boolean" },
		// @ts-expect-error -- a leading "-" in a name
		"-x": { type: "boolean" },
		// @ts-expect-error -- whitespace in a name
		"dry run": { type: "boolean" },
		ok: { type: "boolean" },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- "=" in an alias
		out: { type: "string", aliases: ["o=x"] },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- an alias written with its dashes
		out: { type: "string", aliases: ["--output"] },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- "-" can only be the `--` terminator or a positional
		out: { type: "boolean", short: "-" },
	});
	// @ts-expect-error -- defineFlag checks its own spellings
	defineFlag({ type: "string", aliases: ["out put"] });
	defineContext("ctx").flags({
		// @ts-expect-error -- Context flags follow the same rule
		"a=b": { type: "string" },
	});
	defineExtension(defineExtensionId("test:shape")).flags({
		// @ts-expect-error -- Extension flags follow the same rule
		"-x": { type: "string" },
	});
	// `-=` addresses a short "="; dynamic spellings are runtime-checked.
	new Crust("cli").flags({ eq: { type: "boolean", short: "=" } });
	new Crust("cli").flags({ [name]: { type: "boolean", aliases: [alias], short } });
}

function _envAndDelimiter(
	text: string,
	envDelimiter: { name: "T"; delimiter: "" } | { name: "U" },
	envName: { name: ""; delimiter: "," } | { name: string; delimiter: ":" },
	widenedDelimiter: { name: "T"; delimiter: "" } | { name: "U"; delimiter: string },
	validEnv: { name: string; delimiter: string } | { name: "U" },
	emptyEnvBranch: { type: "string"; env: { name: "" } } | { type: "string" },
	emptyDelimiterBranch: { type: "string"; multiple: true; delimiter: "" } | { type: "string" },
) {
	new Crust("cli").flags({
		// @ts-expect-error -- an empty env variable name is never read
		token: { type: "string", env: { name: "" } },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- an empty delimiter splits into characters
		tags: { type: "string", multiple: true, delimiter: "" },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- so does an empty env delimiter
		tags: { type: "string", multiple: true, env: { name: "TAGS", delimiter: "" } },
	});
	// @ts-expect-error -- defineFlag checks its env binding
	defineFlag({ type: "string", env: { name: "" } });
	// One empty literal in an env union is enough: that binding would throw at runtime.
	new Crust("cli").flags({
		// @ts-expect-error -- the first binding's delimiter is empty
		tags: { type: "string", multiple: true, env: envDelimiter },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- the first binding's name is empty, beside an open name
		tags: { type: "string", multiple: true, env: envName },
	});
	new Crust("cli").flags({
		// @ts-expect-error -- a widened sibling delimiter does not hide the empty one
		tags: { type: "string", multiple: true, env: widenedDelimiter },
	});
	// @ts-expect-error -- defineFlag checks each binding too
	defineFlag({ type: "string", multiple: true, env: envDelimiter });
	defineFlag({ type: "string", multiple: true, env: validEnv });
	new Crust("cli").flags({ tags: { type: "string", multiple: true, env: validEnv } });
	// So is one empty literal in a definition union.
	new Crust("cli").flags({
		// @ts-expect-error -- the first branch's env name is empty
		token: emptyEnvBranch,
	});
	new Crust("cli").flags({
		// @ts-expect-error -- the first branch's delimiter is empty
		tags: emptyDelimiterBranch,
	});
	defineContext("ctx").flags({
		// @ts-expect-error -- Contexts check every branch
		token: emptyEnvBranch,
	});
	defineExtension(defineExtensionId("test:env-union")).flags({
		// @ts-expect-error -- as do Extensions
		token: emptyEnvBranch,
	});
	new Crust("cli").flags({
		token: { type: "string", env: { name: text } },
		tags: { type: "string", multiple: true, delimiter: text, env: { name: "T", delimiter: text } },
		list: { type: "string", multiple: true, delimiter: ",", env: { name: "L", delimiter: ":" } },
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
	defineContext("ctx").flags({
		// @ts-expect-error -- Contexts read only string keys too
		[hidden]: { type: "string" },
	});
	defineExtension(defineExtensionId("test:symbol")).flags({
		// @ts-expect-error -- as do Extensions
		[hidden]: { type: "string" },
	});
}

function _unionDefinitionsCheckEveryBranch(
	asyncParse: { type: "boolean" } | { type: "string"; parse: (raw: string) => Promise<string> },
	longShort: { type: "boolean" } | { type: "string"; short: "oo" },
) {
	// @ts-expect-error -- the string branch's parser is async
	new Crust("cli").flags({ value: asyncParse });
	// @ts-expect-error -- the string branch's short is two characters
	new Crust("cli").flags({ out: longShort });
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

function _defineFlagChecksItsDefinition() {
	// @ts-expect-error -- short flags must be one character
	defineFlag({ type: "string", short: "oo" });
	// @ts-expect-error -- default outside choices
	defineFlag({ type: "string", choices: ["a"], default: "b" });
	const verbose = defineFlag({ type: "boolean", short: "v" });
	new Crust("cli")
		.flags({ verbose })
		// @ts-expect-error -- the same definition under another name repeats its short "-v"
		.flags({ loud: verbose });
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
	defineContext("bad")
		.flags({ token: { type: "string", short: "t" } })
		// @ts-expect-error -- collides with the Context's earlier flag
		.flags({ tag: { type: "string", short: "t" } });
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
	// @ts-expect-error -- the Extension's "trace" collides with an application flag
	new Crust("cli").flags({ trace: { type: "string" } }).extend(trace);
	defineExtension(defineExtensionId("test:bad"))
		.flags({ out: { type: "string", short: "o" } })
		// @ts-expect-error -- collides with the Extension's earlier flag
		.flags({ open: { type: "string", short: "o" } });
}
