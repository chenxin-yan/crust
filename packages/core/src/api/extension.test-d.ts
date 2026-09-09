import type { Equal, Expect } from "../../tests/helpers.ts";
import { Crust, defineCommand, type AnyCrust, type RootCommandMeta } from "../command/crust.ts";
import type { CommandSnapshot } from "../command/snapshot.ts";
import { defineExtensionId } from "../identity.ts";
import { runtime } from "../runtime.ts";
import type { CommandSection } from "../types.ts";
import { defineContext } from "./context.ts";
import { defineExtension, type Extension } from "./extension.ts";

function _metadataRequirements() {
	const ID = defineExtensionId("test:metadata");
	const needsVersion = defineExtension<"version">()(ID, {
		hooks: {
			preRun(ctx) {
				type _version = Expect<Equal<typeof ctx.rootCommand.meta.version, string>>;
				type _description = Expect<
					Equal<typeof ctx.rootCommand.meta.description, string | undefined>
				>;
				type _command = Expect<Equal<typeof ctx.command.meta.version, string | undefined>>;
			},
			postRun(ctx) {
				const _value: string = ctx.rootCommand.meta.version;
			},
			onError(_error, ctx) {
				const _value: string = ctx.rootCommand.meta.version;
			},
		},
		build({ snapshot }) {
			const _value: string = snapshot.meta.version;
		},
		sections(snapshot) {
			const _value: string = snapshot.meta.version;
			return runtime([]);
		},
	});
	const plain = defineExtension(ID, {
		hooks: {
			preRun(ctx) {
				type _version = Expect<Equal<typeof ctx.rootCommand.meta.version, string | undefined>>;
				const _snapshot: CommandSnapshot = ctx.rootCommand;
			},
		},
	});
	defineExtension()(ID);
	// @ts-expect-error Only authored root metadata keys may be required.
	defineExtension<"versin">();
	// @ts-expect-error Arbitrary fields are not preserved by the root builder.
	defineExtension<"version" | "imaginary">();
	// @ts-expect-error Subcommand-only metadata is not a root requirement.
	defineExtension<"aliases">();
	const needsUsage = defineExtension<"usage">()(ID);
	// @ts-expect-error Requirements apply even without an invocation hook.
	new Crust("app").extend(needsUsage);
	new Crust("app", { usage: "app" }).extend(needsUsage);
	const sections = defineExtension<"sections">()(ID, {
		hooks: {
			preRun(ctx) {
				type _sections = Expect<
					Equal<typeof ctx.rootCommand.meta.sections, readonly CommandSection[]>
				>;
			},
		},
	});
	new Crust("app", { sections: [] }).extend(sections);
	new Crust("app", {
		version: "1",
		usage: "app",
		sections: [{ title: "Examples", body: "app --help", only: [ID] }],
	}).extend(sections, needsVersion);
	// @ts-expect-error Fresh section literals reject unknown audience keys.
	new Crust("app", { sections: [{ title: "Examples", body: "app", onlyy: [] }] });
	const multi = defineExtension<"version" | "description">()(ID, {
		hooks: {
			preRun(ctx) {
				const _version: string = ctx.rootCommand.meta.version;
				const _description: string = ctx.rootCommand.meta.description;
				type _usage = Expect<Equal<typeof ctx.rootCommand.meta.usage, string | undefined>>;
			},
		},
	});
	new Crust("app").extend(plain);
	// @ts-expect-error Missing required root version.
	new Crust("app").extend(needsVersion);
	// @ts-expect-error A different metadata key cannot satisfy version.
	new Crust("app", { description: "app" }).extend(needsVersion);
	// @ts-expect-error Both metadata keys are required.
	new Crust("app", { version: "1" }).extend(multi);
	new Crust("app", { version: "1", description: "app" }).extend(multi);
	// @ts-expect-error Unknown root metadata keys are rejected alongside known keys.
	new Crust("app", { version: "1", descripton: "typo" });
	// @ts-expect-error Subcommand aliases are not root metadata, even alongside a version.
	new Crust("app", { version: "1", aliases: ["cli"] });
	const app = new Crust("app", { version: "1" });
	app.extend(needsVersion, plain);
	app.extend(plain, needsVersion);
	app.extend(plain).extend(needsVersion);
	app.flags({ name: "verbose", type: "boolean" }).extend(needsVersion);
	app.args({ name: "file", type: "string" }).extend(needsVersion);
	app.action(() => 42).extend(needsVersion);
	const logger = defineContext("logger", () => ({ info: () => {} }));
	app.provide(logger()).extend(needsVersion);
	const sub = defineCommand("sub", (cmd) => cmd.action(() => 42));
	app.add(sub).extend(needsVersion);
	app.command("child", (cmd) => cmd.action(() => 42)).extend(needsVersion);
	app
		.flags({ name: "verbose", type: "boolean" })
		.args({ name: "file", type: "string" })
		.provide(logger())
		.add(sub)
		.command("child", (cmd) => cmd.action(() => 42))
		.action(() => 42)
		.extend(needsVersion);
	const _broad: AnyCrust = app;
	const unversioned = new Crust("app");
	const _broadPlain: AnyCrust = unversioned;
	// @ts-expect-error Structural assignment must not manufacture metadata.
	const _laundered: typeof app = unversioned;
	const VersionedCrust = Crust<
		{},
		[],
		{},
		never,
		never,
		{},
		{},
		{ extension: never; tree: never; demands: {}; pending: never },
		void,
		{ version: string }
	>;
	// @ts-expect-error Explicit type arguments cannot manufacture metadata.
	new VersionedCrust("app");
	// @ts-expect-error Explicit undefined cannot manufacture metadata either.
	new VersionedCrust("app", undefined);
	const meta: RootCommandMeta = { version: "1" };
	// @ts-expect-error Widened metadata does not guarantee a version.
	new Crust("app", meta).extend(needsVersion);
	const specific = { version: "1" } satisfies RootCommandMeta;
	new Crust("app", specific).extend(needsVersion);
	const maybe = Math.random() ? "1" : undefined;
	// @ts-expect-error Possibly undefined fields do not satisfy a requirement.
	new Crust("app", { version: maybe }).extend(needsVersion);
	const union = Math.random() ? { version: "1" } : { description: "app" };
	// @ts-expect-error Every union member must satisfy the requirement.
	new Crust("app", union).extend(needsVersion);
	const optionalMeta = Math.random() ? { version: "1" } : undefined;
	const optionalApp = new Crust("app", optionalMeta);
	// @ts-expect-error An optional metadata argument cannot promise required fields.
	optionalApp.extend(needsVersion);
	const widenedOptionalMeta: RootCommandMeta | undefined = optionalMeta;
	const widenedOptionalApp = new Crust("app", runtime(widenedOptionalMeta));
	// @ts-expect-error Widened optional metadata cannot promise required fields either.
	widenedOptionalApp.extend(needsVersion);
	const conditional = Math.random() ? plain : needsVersion;
	// @ts-expect-error Conditional extensions retain their metadata requirements.
	unversioned.extend(runtime([conditional]));
	app.extend(runtime([conditional]));
	const tuple = [plain, needsVersion] as const;
	const list = [plain, needsVersion];
	// @ts-expect-error Tuple spread retains requirements.
	unversioned.extend(...tuple);
	// @ts-expect-error Array spread retains requirements.
	unversioned.extend(...list);
	app.extend(...tuple);
	app.extend(runtime(list));
	// @ts-expect-error Ordinary Extension promises it accepts metadata-free contexts.
	const _widened: Extension = needsVersion;
	// @ts-expect-error Replacement does not undo the first registration's requirement.
	unversioned.extend(needsVersion, plain);
}

function _curriedInference() {
	const ID = defineExtensionId("test:inference");
	const logger = defineContext("logger", () => ({ info: () => {} }));
	const instance = logger();
	const command = defineCommand("docs", (cmd) => cmd.action(() => "docs"));
	const logging = defineExtension<"version">()(ID, (_label: string) => ({
		uses: [logger],
		provides: [instance],
		commands: [command],
		flags: [{ name: "verbose", type: "boolean", short: "v" }],
		hooks: {
			async preRun({ rootCommand, ctx, flags }) {
				const _version: string = rootCommand.meta.version;
				type _flag = Expect<Equal<typeof flags.verbose, boolean | undefined>>;
				(await ctx.logger).info();
			},
		},
	}));
	type _args = Expect<Equal<Parameters<typeof logging>, [label: string]>>;
	// @ts-expect-error Currying must not erase factory arguments.
	logging(123);
	const extension = logging("docs");
	type _flags = Expect<Equal<NonNullable<typeof extension._flagDefs>[0]["name"], "verbose">>;
	type _commands = Expect<Equal<typeof extension.commands, readonly [typeof command] | undefined>>;
	const app = new Crust("app", { version: "1" }).extend(extension);
	void app.run(["docs"], { flags: { verbose: true } });
	app.action(async ({ ctx }) => {
		const _value: { info: () => void } = await ctx.logger;
	});
	// @ts-expect-error The contributed flag still participates in collisions.
	app.flags({ name: "verbose", type: "string" });
	const needsLogger = defineExtension<"version">()(ID, { uses: [logger] });
	// @ts-expect-error Metadata requirements must not erase Context requirements.
	new Crust("app", { version: "1" }).extend(needsLogger);
	new Crust("app", { version: "1" }).provide(logger()).extend(needsLogger);
	const ordinary = defineExtension(ID, (label: string) => ({
		flags: [{ name: "label", type: "string", default: label }],
	}));
	type _ordinaryArgs = Expect<Equal<Parameters<typeof ordinary>, [label: string]>>;
	const flags = [{ name: "label", type: "string" }] as const;
	const explicit = defineExtension<[label: string], typeof flags>(ID, (_label) => ({ flags }));
	// @ts-expect-error Old explicit factory type arguments still constrain calls.
	explicit(123);
	explicit("value");
}
