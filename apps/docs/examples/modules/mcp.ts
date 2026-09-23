//#region extension
import { type AnyCrust, Crust, defineCommand } from "@crustjs/core";
import { mcpExtension } from "@crustjs/mcp";

const deploy = defineCommand("deploy", { description: "Deploy the app" }, (command) =>
	command
		.args({ name: "target", type: "string", required: true, choices: ["staging", "prod"] })
		.flags({ name: "dry-run", type: "boolean" })
		.action(({ args, flags }) => ({ target: args.target, dryRun: flags["dry-run"] === true })),
);

// `app` is read when `mcp` runs, so the callback may return the variable being
// assigned; the return annotation breaks the type-inference cycle.
export const app = new Crust("my-cli", { description: "Manage deployments", version: "1.2.3" })
	.add(deploy)
	.add(defineCommand("wipe", { description: "Delete everything" }, (c) => c.action(() => {})))
	.extend(mcpExtension({ app: (): AnyCrust => app, exclude: [["wipe"]] }));
//#endregion

//#region headless
import { createMcpServer, serveStdio } from "@crustjs/mcp";

const server = await createMcpServer(app, { exclude: [["wipe"]] });
await serveStdio(server);
//#endregion

//#region manifest
import { toolsFromSnapshot } from "@crustjs/mcp";

const tools = toolsFromSnapshot(await app.snapshot());
console.log(tools.map((tool) => tool.name)); // => ["deploy"]
console.log(tools[0]?.inputSchema);
// => {
//   type: "object",
//   properties: {
//     target: { type: "string", enum: ["staging", "prod"] },
//     "dry-run": { type: "boolean" },
//     raw: { type: "array", items: { type: "string" }, description: "Passthrough values, as if written after `--`" },
//   },
//   required: ["target"],
// }
//#endregion
