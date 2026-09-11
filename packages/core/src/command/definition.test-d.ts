import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import { Crust, defineCommand } from "./crust.ts";

// Compile-time regression checks; intentionally never invoked.
// infers pulled Context values while preserving fluent action types
function _typecheckInfersPulledContextValuesWhilePreservingFluentActionTypes() {
	const auth = defineContext("auth", () => ({ user: "yan" }));
	const region = defineContext("region", () => "us-east-1");
	const definition = defineCommand("deploy", (command) =>
		command
			.use(auth)
			.args({ name: "target", type: "string", required: true })
			.flags({ name: "force", type: "boolean", required: true })
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
					child.flags({ name: "mode", type: "string" }).action(() => {}),
				),
			)
			.action(({ args }) => {
				type _Source = Expect<Equal<typeof args.source, string>>;
			}),
	);
}

// capability constraints keep root-only operations uncallable in recipes across fluent transitions
function _typecheckRestrictsBuilderCapabilities() {
	const auth = defineContext("auth", () => ({ user: "yan" }));
	const extension = defineExtension(defineExtensionId("nested"));
	const app = new Crust("app");

	// @ts-expect-error -- Context demand declarations are recipe-only
	app.use(auth);
	app.command("child", (command) => command);
	app.extend(extension);

	defineCommand("configured", (command) => {
		const configured = command
			.flags({ name: "force", type: "boolean" })
			.use(auth)
			.action(async ({ ctx }) => (await ctx.auth).user);

		// @ts-expect-error -- Extensions are root-only
		configured.extend(extension);
		// @ts-expect-error -- Inline commands are root-only
		configured.command("nested", (child) => child);
		// @ts-expect-error -- Programmatic invocation is root-only
		void configured.run([]);
		// @ts-expect-error -- CLI execution is root-only
		void configured.execute();
		// @ts-expect-error -- Snapshots are root-only
		void configured.snapshot();

		return configured;
	});
}
