import type { Equal, Expect } from "../../tests/helpers.ts";
import { Crust, defineCommand } from "../command/crust.ts";
import { defineExtensionId } from "../identity.ts";
import { type AnyContextFactory, defineContext } from "./context.ts";
import { defineExtension } from "./extension.ts";
import { defineFlag } from "./flags.ts";

const apiKey = defineFlag("api-key", { type: "string", short: "k", aliases: ["token"] });

// Compile-time regression checks; intentionally never invoked.
// merges owned flag types from multiple Contexts in one provide call
function _typecheckMergesOwnedFlagTypesFromMultipleContextsInOneProvideCall() {
	const auth = defineContext("auth", { flags: [apiKey] }, () => ({}));
	const format = defineFlag("format", { type: "string", choices: ["json", "text"] });
	const output = defineContext("output", { flags: [format] }, () => ({}));
	const app = new Crust("cli").provide(auth(), output());

	type _FlagKeys = Expect<Equal<keyof (typeof app)["_types"]["flags"], "api-key" | "format">>;
	type _ApiKey = Expect<Equal<(typeof app)["_types"]["flags"]["api-key"]["type"], "string">>;
	type _Format = Expect<Equal<(typeof app)["_types"]["flags"]["format"]["type"], "string">>;
}

// checks dependency graphs at every composition boundary
function _typecheckChecksDependencyGraphsAtEveryCompositionBoundary() {
	const config = defineContext("config", () => ({ url: "memory://" }));
	const db = defineContext("db", { use: [config] }, async ({ ctx }) => {
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
		// @ts-expect-error -- use entries must be Context factories
		defineContext("bad", { use: [42] }, () => 1);
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
	const config = defineContext("config", () => ({ url: "memory://" }));
	const db = defineContext("db", { use: [config] }, async ({ ctx }) => await ctx.config);

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
	const config = defineContext("config", () => ({ url: "memory://" }));
	const db = defineContext("db", { use: [config] }, async ({ ctx }) => await ctx.config);
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

// checks literal Context sections like command sections
function _typecheckChecksLiteralContextSections() {
	const man = defineExtensionId("man");
	defineContext("env", { sections: [{ title: "Environment", body: "APP_TOKEN" }] }, () => 1);
	defineContext("env", { sections: [{ title: "Env", body: "x", only: [man] }] }, () => 1);
	// @ts-expect-error -- section titles must be nonblank
	defineContext("env", { sections: [{ title: "", body: "APP_TOKEN" }] }, () => 1);
	// @ts-expect-error -- section audiences must be nonempty
	defineContext("env", { sections: [{ title: "Env", body: "x", only: [] }] }, () => 1);
	defineContext(
		"env",
		// @ts-expect-error -- only and except are mutually exclusive
		{ sections: [{ title: "Env", body: "x", only: [man], except: [man] }] },
		() => 1,
	);
	const env = defineContext("env", { sections: [{ title: "Env", body: "x" }] }, () => "value");
	type _Value = Expect<Equal<Awaited<ReturnType<ReturnType<typeof env>["setup"]>>, string>>;
}
