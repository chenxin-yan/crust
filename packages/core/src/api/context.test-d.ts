import type { Equal, Expect } from "../../tests/helpers.ts";
import { Crust, defineCommand } from "../command/crust.ts";
import { defineExtensionId } from "../identity.ts";
import {
	type AnyContextFactory,
	type ContextFactory,
	type ContextValue,
	defineContext,
} from "./context.ts";
import { defineExtension } from "./extension.ts";
import { defineFlag } from "./flags.ts";

const apiKey = defineFlag("api-key", { type: "string", short: "k", aliases: ["token"] });

// Compile-time regression checks; intentionally never invoked.
// merges owned flag types from multiple Contexts in one provide call
function _typecheckMergesOwnedFlagTypesFromMultipleContextsInOneProvideCall() {
	const auth = defineContext("auth")
		.flags(apiKey)
		.setup(() => ({}));
	const format = defineFlag("format", { type: "string", choices: ["json", "text"] });
	const output = defineContext("output")
		.flags(format)
		.setup(() => ({}));
	const app = new Crust("cli").provide(auth(), output());

	type _FlagKeys = Expect<Equal<keyof (typeof app)["_types"]["flags"], "api-key" | "format">>;
	type _ApiKey = Expect<Equal<(typeof app)["_types"]["flags"]["api-key"]["type"], "string">>;
	type _Format = Expect<Equal<(typeof app)["_types"]["flags"]["format"]["type"], "string">>;
}

// checks dependency graphs at every composition boundary
function _typecheckChecksDependencyGraphsAtEveryCompositionBoundary() {
	const config = defineContext("config").setup(() => ({ url: "memory://" }));
	const db = defineContext("db")
		.use(config)
		.setup(async ({ ctx }) => {
			// @ts-expect-error -- setup bags expose only declared Contexts
			void ctx.logger;
			return { url: (await ctx.config).url };
		});
	const fake = db.of({ url: "fake" });
	new Crust("cli").provide(fake);
	new Crust("cli").provide(db(), config());

	const command = defineCommand("run", (builder) =>
		builder.use(db).action(async ({ ctx }) => {
			void (await ctx.db);
			// @ts-expect-error -- action bags expose only declared Contexts
			void ctx.logger;
		}),
	);
	new Crust("cli").provide(config(), db()).add(command);

	const extension = defineExtension(defineExtensionId("typed-deps"))
		.use(db)
		.preRun(async ({ ctx }) => void (await ctx.db));
	new Crust("cli").provide(config(), db()).extend(extension);

	const widened: AnyContextFactory = config;
	new Crust("cli").provide(widened(undefined));

	const invalidCompositions = () => {
		// @ts-expect-error -- db's transitive dependency closure is unsatisfied
		new Crust("cli").provide(db());
		defineContext("bad")
			// @ts-expect-error -- use entries must be Context factories
			.use(42)
			.setup(() => 1);
		// @ts-expect-error -- command dependencies are checked by .add()
		new Crust("cli").add(command);
		// @ts-expect-error -- Extension dependencies are checked by .extend()
		new Crust("cli").extend(extension);
		const badProvide = defineExtension(defineExtensionId("bad-provide")).provide(db());
		// @ts-expect-error -- Extension providers with unmet transitive deps are checked by .extend()
		new Crust("cli").extend(badProvide);
		const badCommand = defineExtension(defineExtensionId("bad-command")).add(command);
		// @ts-expect-error -- Extension-contributed command deps are checked by .extend()
		new Crust("cli").extend(badCommand);
	};
	void invalidCompositions;
}

// brands inline .use() demands that the call site does not provide
function _typecheckBrandsInlineUseDemandsThatTheCallSiteDoesNotProvide() {
	const config = defineContext("config").setup(() => ({ url: "memory://" }));
	const db = defineContext("db")
		.use(config)
		.setup(async ({ ctx }) => await ctx.config);

	// Satisfied demand (including db's transitive closure) composes cleanly.
	new Crust("cli")
		.provide(config(), db())
		.command("query", (cmd) => cmd.use(db).action(async ({ ctx }) => void (await ctx.db)));

	const invalidCompositions = () => {
		// @ts-expect-error -- inline .use(db) demand is unmet at the call site
		new Crust("cli").command("query", (cmd) => cmd.use(db).action(() => {}));
		new Crust("cli")
			.provide(db.of({ url: "fake" }))
			// @ts-expect-error -- db's transitive config dependency is still unmet
			.command("query", (cmd) => cmd.use(db).action(() => {}));
		// @ts-expect-error -- .use() takes factories; instances belong to .provide()
		new Crust("cli").provide(config(), db()).command("query", (cmd) => cmd.use(db()));
	};
	void invalidCompositions;
}

// keeps .use() brand parity for defineCommand at .add() and .extend()
function _typecheckKeepsUseBrandParityForDefineCommandAtAddAndExtend() {
	const config = defineContext("config").setup(() => ({ url: "memory://" }));
	const db = defineContext("db")
		.use(config)
		.setup(async ({ ctx }) => await ctx.config);
	const query = defineCommand("query", (cmd) =>
		cmd.use(db).action(async ({ ctx }) => void (await ctx.db)),
	);
	const carrier = defineExtension(defineExtensionId("carrier")).add(query);

	new Crust("cli").provide(config(), db()).add(query);
	new Crust("cli").provide(config(), db()).extend(carrier);

	const invalidCompositions = () => {
		// @ts-expect-error -- db's transitive config dependency is unmet at .add()
		new Crust("cli").provide(db.of({ url: "fake" })).add(query);
		// @ts-expect-error -- db's transitive config dependency is unmet at .extend()
		new Crust("cli").provide(db.of({ url: "fake" })).extend(carrier);
	};
	void invalidCompositions;
}

// brands inline flags that collide with registered Extension flags, matching .add()
function _typecheckBrandsInlineFlagsThatCollideWithRegisteredExtensionFlagsMatchingAdd() {
	const tracer = defineExtension(defineExtensionId("tracer")).flags({
		name: "trace",
		type: "boolean",
	});
	const rootOnly = defineExtension(defineExtensionId("root-only")).flags({
		name: "depth",
		type: "string",
		recursive: false,
	});
	const nestedColliding = defineCommand("child", (cmd) =>
		cmd.flags({ name: "trace", type: "boolean" }).action(() => {}),
	);

	// Collision-free recipes compose cleanly after .extend().
	new Crust("cli").extend(tracer).command("ok", (cmd) => cmd.action(() => {}));

	const invalidCompositions = () => {
		new Crust("cli")
			.extend(tracer)
			// @ts-expect-error -- nested child's "trace" collides with tracer's recursive flag (parity with .add())
			.command("query", (cmd) => cmd.add(nestedColliding).action(() => {}));
		new Crust("cli")
			.extend(rootOnly)
			// @ts-expect-error -- inline "depth" collides with a registered Extension flag (parity with .add())
			.command("query", (cmd) => cmd.flags({ name: "depth", type: "string" }).action(() => {}));
	};
	void invalidCompositions;
}

// infers options, ctx, flags, and the value together from one fluent chain
function _typecheckInfersOptionsCtxFlagsAndValueTogether() {
	const config = defineContext("config").setup(() => ({ url: "memory://" }));
	const logger = defineContext("logger").setup(() => ({ level: 1 }));
	const db = defineContext("db")
		.use(config)
		.flags(apiKey)
		.use(logger)
		.flags({ name: "pool", type: "number", default: 4 })
		.setup(async ({ ctx, flags }, options: { schema: string }) => {
			type _Key = Expect<Equal<(typeof flags)["api-key"], string | undefined>>;
			type _Pool = Expect<Equal<typeof flags.pool, number>>;
			type _Config = Expect<Equal<Awaited<typeof ctx.config>, { url: string }>>;
			type _Logger = Expect<Equal<Awaited<typeof ctx.logger>, { level: number }>>;
			// @ts-expect-error -- setup bags expose only chained .use() Contexts
			void ctx.cache;
			return { url: (await ctx.config).url, schema: options.schema, pool: flags.pool };
		});
	type _Options = Expect<Equal<Parameters<typeof db>, [options: { schema: string }]>>;
	type _Value = Expect<
		Equal<Parameters<typeof db.of>[0], { url: string; schema: string; pool: number }>
	>;
	const app = new Crust("cli").provide(config(), logger(), db({ schema: "public" }));
	type _OwnedFlags = Expect<Equal<keyof (typeof app)["_types"]["flags"], "api-key" | "pool">>;
	const invalid = () => {
		// @ts-expect-error -- db's transitive closure includes every chained .use() factory
		new Crust("cli").provide(config(), db({ schema: "public" }));
		// @ts-expect-error -- options are typed by the annotated setup parameter
		db({ schema: 1 });
	};
	void invalid;
}

// infers factory options from the optional second setup parameter
function _typecheckInfersFactoryOptionsFromTheSecondSetupParameter() {
	const none = defineContext("none").setup(() => 1);
	none();
	none(undefined);
	type _None = Expect<Equal<typeof none, ContextFactory<"none", void, number>>>;

	const required = defineContext("required").setup((_input, options: { url: string }) => options);
	required({ url: "x" });
	type _Required = Expect<Equal<Parameters<typeof required>, [options: { url: string }]>>;

	const optional = defineContext("optional").setup((_input, options?: { url: string }) => options);
	optional();
	optional({ url: "x" });

	const defaulted = defineContext("defaulted").setup(
		(_input, options: { url: string } = { url: "x" }) => options.url,
	);
	defaulted();
	defaulted({ url: "y" });

	// Context policy: options may be omitted whenever their type accepts undefined.
	const union = defineContext("union").setup((_input, options: string | undefined) => options);
	union();
	union("x");

	const invalid = () => {
		// @ts-expect-error -- required options must be passed
		required();
		// @ts-expect-error -- no-option factories take no options
		none(1);
		// @ts-expect-error -- a Context factory takes at most one options value
		defineContext("pair").setup((_input, first: string, second: number) => first + second);
	};
	void invalid;

	const widened: AnyContextFactory = required;
	const exact: ContextFactory<"required", { url: string }, { url: string }> = required;
	void [widened, exact];
}

// keeps fluent builders immutable and checks owned flags across chained calls
function _typecheckKeepsBuildersImmutableAndChecksChainedFlags() {
	const base = defineContext("auth").flags(apiKey);
	const withRegion = base.flags({ name: "region", type: "string" });
	const withTrace = base.flags({ name: "trace", type: "boolean" });
	withRegion.setup(({ flags }) => {
		void flags.region;
		// @ts-expect-error -- sibling branch flags never leak
		void flags.trace;
	});
	withTrace.setup(({ flags }) => {
		void flags.trace;
		// @ts-expect-error -- sibling branch flags never leak
		void flags.region;
	});

	const invalid = () => {
		// @ts-expect-error -- a later .flags() call collides with an earlier canonical name
		base.flags({ name: "api-key", type: "string" });
		// @ts-expect-error -- a later .flags() call collides with an earlier alias
		base.flags({ name: "credentials", type: "string", aliases: ["token"] });
	};
	void invalid;
}

// rejects incomplete builders and the removed config/setup call forms
function _typecheckRejectsIncompleteBuildersAndRemovedCallForms() {
	const builder = defineContext("pending").flags(apiKey);
	const invalid = () => {
		// @ts-expect-error -- a builder is not a factory until .setup()
		builder();
		// @ts-expect-error -- a builder has no .of()
		builder.of(1);
		// @ts-expect-error -- consumers .use() factories, not builders
		defineContext("consumer").use(builder);
		// @ts-expect-error -- commands .use() factories, not builders
		new Crust("cli").command("run", (cmd) => cmd.use(builder).action(() => {}));
		// @ts-expect-error -- providers take instances, not builders
		new Crust("cli").provide(builder);
		// @ts-expect-error -- defineContext(name, setup) was removed
		defineContext("old", () => 1);
		// @ts-expect-error -- defineContext(name, config, setup) was removed
		defineContext("old", { flags: [apiKey] }, () => 1);
		// @ts-expect-error -- setup input no longer carries options
		defineContext("old").setup(({ options }) => options);
	};
	void invalid;
}

// accepts widened and empty .use() spreads with open dependency closures
function _typecheckAcceptsWidenedAndEmptyUseSpreads(deps: readonly AnyContextFactory[]) {
	const dynamic = defineContext("dynamic")
		.use(...deps)
		.setup(async ({ ctx }) => ctx.anything);
	type _Open = Expect<Equal<NonNullable<(typeof dynamic)["_deps"]>, Record<string, ContextValue>>>;
	// Open closures are checked by the runtime availability check at composition.
	new Crust("cli").provide(dynamic());

	const empty = defineContext("empty")
		.use()
		.setup(() => 1);
	type _Empty = Expect<Equal<NonNullable<(typeof empty)["_deps"]>, {}>>;
	new Crust("cli").provide(empty());
}
