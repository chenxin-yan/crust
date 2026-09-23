import {
	type AnyCrust,
	type CommandShapeAt,
	Crust,
	defineCommand,
	type RunInput,
} from "@crustjs/core";

import { mcpExtension } from "./extension.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// Compile-time regression checks; intentionally never invoked.
// installing the Extension keeps the host's command tree precise
function _typecheckKeepsHostCommandTreePrecise() {
	const deploy = defineCommand("deploy", (command) =>
		command
			.args({ name: "target", type: "string", required: true })
			.flags({ name: "dry-run", type: "boolean" })
			.action(({ args }) => ({ target: args.target })),
	);
	const app = new Crust("cli").add(deploy).extend(mcpExtension({ app: (): AnyCrust => app }));
	type Shape = (typeof app)["_types"]["shape"];

	type DeployInput = RunInput<CommandShapeAt<Shape, readonly ["deploy"]>>;
	type _deployArgs = Expect<Equal<DeployInput["args"], { target: string }>>;
	type _deployFlags = Expect<Equal<NonNullable<DeployInput["flags"]>, { "dry-run"?: boolean }>>;
	type _deployResult = Expect<
		Equal<CommandShapeAt<Shape, readonly ["deploy"]>["result"], { target: string }>
	>;

	// The contributed commands are typed too.
	type ConfigInput = RunInput<CommandShapeAt<Shape, readonly ["mcp", "config"]>>;
	type _configFlags = Expect<
		Equal<NonNullable<ConfigInput["flags"]>, { client?: "claude" | "cursor" | "vscode" }>
	>;
	type _mcpResult = Expect<Equal<CommandShapeAt<Shape, readonly ["mcp"]>["result"], void>>;

	void app.run(["deploy"], { args: { target: "prod" } });
	void app.run(["mcp", "config"], { flags: { client: "vscode" } });
	// @ts-expect-error -- unknown command paths stay rejected after extend()
	void app.run(["nonexistent"]);
	// @ts-expect-error -- unknown flags stay rejected
	void app.run(["mcp", "config"], { flags: { other: true } });
}
