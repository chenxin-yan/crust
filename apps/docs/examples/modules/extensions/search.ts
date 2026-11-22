//#region usage
import { Crust, defineCommand } from "@crustjs/core";
import { json, search } from "@crustjs/extensions";

const app = new Crust("my-cli").extend(search(), json()).add(
	defineCommand("keys", { description: "Manage API keys" }, (cmd) =>
		cmd.add(
			defineCommand("rotate", { description: "Rotate an API key" }, (sub) => sub.action(() => {})),
			defineCommand("list", { description: "List API keys" }, (sub) => sub.action(() => {})),
		),
	),
	defineCommand("deploy", { description: "Deploy the app" }, (cmd) => cmd.action(() => {})),
);

await app.execute();
//#endregion

export async function matches() {
	//#region run
	const outcome = await app.run(["search"], { args: { task: ["rotate", "key"] } });
	if (outcome.status === "completed") console.log(outcome.result[0]?.command); // my-cli keys rotate
	//#endregion
}
