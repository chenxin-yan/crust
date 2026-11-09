import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import { Crust, defineCommand } from "./crust.ts";

// Compile-time regression checks; intentionally never invoked.
// infers pulled Context values while preserving fluent action types
function _typecheckInfersPulledContextValuesWhilePreservingFluentActionTypes() {
	const auth = defineContext("auth").setup(() => ({ user: "yan" }));
	const region = defineContext("region").setup(() => "us-east-1");
	const definition = defineCommand("deploy", (command) =>
		command
			.use(auth)
			.args({ name: "target", type: "string", required: true })
			.flags({ force: { type: "boolean", required: true } })
			.provide(region())
			.action(async ({ args, flags, ctx }) => {
				const identity = await ctx.auth;
				const location = await ctx.region;
				type _Target = Expect<Equal<typeof args.target, string>>;
				type _Force = Expect<Equal<typeof flags.force, boolean>>;
				type _Auth = Expect<Equal<typeof identity, { user: string }>>;
				type _Region = Expect<Equal<typeof location, string>>;
			}),
	);

	new Crust("cli").provide(auth()).add(definition);
}

// a recipe with a required arg that nests a flagged child must still satisfy the erased recipe bound
// (a partially-`any` Crust bound falls back to structural checks and rejects the args tuple)
function _typecheckNestedFlaggedDefinitionAfterArgsSatisfiesErasedBuilder() {
	defineCommand("parent", (command) =>
		command
			.args({ name: "source", type: "string", required: true })
			.add(
				defineCommand("child", (child) =>
					child.flags({ mode: { type: "string" } }).action(() => {}),
				),
			)
			.action(({ args }) => {
				type _Source = Expect<Equal<typeof args.source, string>>;
			}),
	);
}

// capability constraints keep root-only operations uncallable in recipes across fluent transitions
function _typecheckRestrictsBuilderCapabilities() {
	const auth = defineContext("auth").setup(() => ({ user: "yan" }));
	const extension = defineExtension(defineExtensionId("nested"));
	const app = new Crust("app");

	// @ts-expect-error -- Context demand declarations are recipe-only
	app.use(auth);
	app.command("child", (command) => command);
	app.extend(extension);

	defineCommand("configured", (command) => {
		const configured = command
			.flags({ force: { type: "boolean" } })
			.use(auth)
			.action(async ({ ctx }) => (await ctx.auth).user);

		// @ts-expect-error -- Extensions are root-only
		configured.extend(extension);
		// @ts-expect-error -- Programmatic invocation is root-only
		void configured.run([]);
		// @ts-expect-error -- CLI execution is root-only
		void configured.execute();
		// @ts-expect-error -- Snapshots are root-only
		void configured.snapshot();

		return configured;
	});
}

// both call forms require a recipe; there is no runtime check for an omitted one
function _typecheckRequiresARecipe(
	recipe: Parameters<typeof defineCommand>[2],
	maybe: Parameters<typeof defineCommand>[2] | undefined,
) {
	// @ts-expect-error -- the name-only form needs a recipe
	defineCommand("deploy");
	// @ts-expect-error -- the config form needs a recipe too
	defineCommand("deploy", { description: "Deploy" });
	defineCommand("deploy", { description: "Deploy" }, recipe);
	// @ts-expect-error -- a possibly missing recipe is rejected
	defineCommand("deploy", { description: "Deploy" }, maybe);
}

// inline `.command()` takes the same config as `defineCommand`, checked the same way
function _typecheckInlineCommandConfig() {
	const app = new Crust("cli")
		.command("list", { description: "List", aliases: ["ls"], hidden: false }, (c) =>
			c.action(() => 1),
		)
		.command("show", { sections: [{ title: "Notes", body: "Read-only." }] }, (c) => c);
	type Outcome<P extends readonly string[]> = Awaited<ReturnType<typeof app.run<P>>>;
	type _Alias = Expect<Equal<Outcome<["ls"]>, Outcome<["list"]>>>;
	type _Result = Expect<Equal<Extract<Outcome<["ls"]>, { status: "completed" }>["result"], number>>;

	// @ts-expect-error -- an alias collides with a sibling (FIX_COMMAND_COLLISION)
	app.command("other", { aliases: ["list"] }, (c) => c);
	// @ts-expect-error -- a name collides with a sibling alias (FIX_COMMAND_COLLISION)
	app.command("ls", { description: "Again" }, (c) => c);
	// @ts-expect-error -- an alias repeats the name (FIX_ALIAS_SHAPE)
	app.command("other", { aliases: ["other"] }, (c) => c);
	// @ts-expect-error -- an alias must not start with "-" (FIX_ALIAS_SHAPE)
	app.command("other", { aliases: ["-o"] }, (c) => c);
	// @ts-expect-error -- version belongs on the root constructor
	app.command("other", { version: "1.0.0" }, (c) => c);
	// @ts-expect-error -- section titles are nonblank (FIX_SECTION_TEXT)
	app.command("other", { sections: [{ title: " ", body: "x" }] }, (c) => c);
	defineCommand("group", (c) => c.command("get", { description: "Get" }, (get) => get));
}

// an inline child's action sees the Context-owned flags it parses: its parent's, at the call site
function _typecheckInlineChildContextFlags() {
	const home = defineContext("home")
		.flags({ home: { type: "string" } })
		.setup(({ flags }) => flags.home ?? "/");
	const group = defineCommand("group", (c) =>
		c.use(home).command("child", (child) =>
			child.flags({ force: { type: "boolean" } }).action(({ flags }) => {
				type _Flags = Expect<Equal<typeof flags.home, string | undefined>>;
				type _Local = Expect<Equal<typeof flags.force, boolean | undefined>>;
			}),
		),
	);
	new Crust("app")
		.provide(home())
		.add(group)
		.command("child", (child) =>
			// @ts-expect-error -- the parent's Context flag spellings stay taken (FIX_ALIAS_COLLISION)
			child.flags({ home: { type: "string" } }),
		)
		.command("root-child", (child) =>
			child.action(({ flags }) => {
				type _Flags = Expect<Equal<typeof flags.home, string | undefined>>;
			}),
		)
		.add(
			defineCommand("reusable", (c) =>
				c.action(({ flags }) => {
					// @ts-expect-error -- a reusable command parses only the Context flags it uses
					void flags.home;
				}),
			),
		);
}

// a definition demands its children's Contexts; the command that adds it checks them
function _typecheckGroupForwardsChildDemands() {
	const config = defineContext("config").setup(() => ({ root: "." }));
	const other = defineContext("config").setup(() => 1);
	const bump = defineCommand("bump", (c) =>
		c.use(config).action(async ({ ctx }) => (await ctx.config).root),
	);
	const version = defineCommand("version", (c) => c.add(bump));
	const inline = defineCommand("version", (c) =>
		c.command("bump", (b) => b.use(config).action(() => {})),
	);
	const nested = defineCommand("release", (c) => c.add(version));

	new Crust("app").provide(config()).add(version, nested.as("ship"));
	new Crust("app").provide(config()).add(inline);
	new Crust("app").provide(config()).command("release", (c) => c.add(version));
	// a definition that provides the Context forwards nothing
	new Crust("app").add(defineCommand("own", (c) => c.provide(config()).add(bump)));

	// @ts-expect-error -- nothing provides config (FIX_MISSING_DEPENDENCY)
	new Crust("app").add(version);
	// @ts-expect-error -- forwarded through two groups (FIX_MISSING_DEPENDENCY)
	new Crust("app").add(nested);
	// @ts-expect-error -- inline children forward too (FIX_MISSING_DEPENDENCY)
	new Crust("app").add(inline);
	// @ts-expect-error -- an inline group at the root forwards to the root (FIX_MISSING_DEPENDENCY)
	new Crust("app").command("release", (c) => c.add(version));
	// @ts-expect-error -- the forwarded demand keeps its value type (FIX_DEPENDENCY_TYPE)
	new Crust("app").provide(other()).add(version);
}
