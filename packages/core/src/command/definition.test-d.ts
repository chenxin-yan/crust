import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import { type CommandDefinitionBuilder, Crust, defineCommand } from "./crust.ts";

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

// keeps root-only methods off the definition builder
function _typecheckKeepsRootOnlyMethodsOffTheDefinitionBuilder() {
	type _NoExtend = Expect<
		Equal<"extend" extends keyof CommandDefinitionBuilder ? true : false, false>
	>;
	type _NoCommand = Expect<
		Equal<"command" extends keyof CommandDefinitionBuilder ? true : false, false>
	>;
	// `.use()` is a recipe-builder surface; Crust's declared type omits it.
	type _HasUse = Expect<Equal<"use" extends keyof CommandDefinitionBuilder ? true : false, true>>;
	type _NoCrustUse = Expect<Equal<"use" extends keyof Crust ? true : false, false>>;
	// `.command()` is root-only: on Crust, not on the definition builder.
	type _CrustCommand = Expect<Equal<"command" extends keyof Crust ? true : false, true>>;

	defineCommand("configured", (command) => {
		// @ts-expect-error -- Extensions are root-only
		command.extend(defineExtension(defineExtensionId("nested")));
		const configured = command
			.args({ name: "target", type: "string" })
			.flags({ name: "force", type: "boolean" })
			.provide(defineContext("region", () => "us")());
		type _StillNoExtend = Expect<
			Equal<"extend" extends keyof typeof configured ? true : false, false>
		>;
		return configured;
	});
}
