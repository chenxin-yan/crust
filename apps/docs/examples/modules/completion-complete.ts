import { completion } from "@crustjs/completion";
import { Crust, defineCommand } from "@crustjs/core";

async function branches(): Promise<string[]> {
	return ["main", "next", "release"];
}

export const app = new Crust("my-cli", { version: "1.2.3" }).extend(completion()).add(
	defineCommand("checkout", (command) =>
		command
			.args({
				name: "branch",
				type: "string",
				required: true,
				complete: async (typed) => (await branches()).filter((name) => name.startsWith(typed)),
			})
			.action(() => {}),
	),
);
