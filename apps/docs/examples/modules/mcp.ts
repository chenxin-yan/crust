//#region extension
import { Crust, defineCommand } from "@crustjs/core";
import { mcp } from "@crustjs/mcp";

const deploy = defineCommand("deploy", { description: "Deploy the app" }, (command) =>
	command
		.args({ name: "target", type: "string", required: true, choices: ["staging", "prod"] })
		.flags({ "dry-run": { type: "boolean" } })
		.action(({ args, flags }) => ({ target: args.target, dryRun: flags["dry-run"] === true })),
);

// `mcp` serves the tree it runs in, so commands added after `.extend(mcp())` are tools too.
export const app = new Crust("my-cli", { description: "Manage deployments", version: "1.2.3" })
	.extend(mcp())
	.add(deploy)
	.add(
		defineCommand("wipe", { description: "Delete everything", mcp: false }, (c) =>
			c.action(() => {}),
		),
	);
//#endregion

//#region key
export const status = defineCommand(
	"status",
	{ description: "Show deployment status", mcp: { readOnlyHint: true, openWorldHint: false } },
	(command) => command.action(() => ({ healthy: true })),
);

// Opens a browser; an agent cannot finish it.
export const login = defineCommand("login", { description: "Sign in", mcp: false }, (command) =>
	command.action(() => {}),
);
//#endregion

//#region discovery
// Lists search_tools, get_tool_details and call_tool instead of every tool.
export const large = new Crust("my-cli").extend(mcp({ discovery: "progressive" })).add(deploy);
//#endregion

//#region headless
import { serveStdio } from "@crustjs/mcp";

await serveStdio(app);
//#endregion

//#region manifest
import { toolsFromSnapshot } from "@crustjs/mcp";

// `wipe` sets `mcp: false`, so it is not listed.
const tools = toolsFromSnapshot(await app.snapshot());
console.log(tools.map((tool) => tool.name)); // => ["deploy"]
console.log(tools[0]?.inputSchema);
// => {
//   type: "object",
//   properties: {
//     target: { type: "string", enum: ["staging", "prod"] },
//     "dry-run": { type: "boolean" },
//   },
//   required: ["target"],
// }
//#endregion
