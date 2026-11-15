import { Crust } from "@crustjs/core";

const tool = new Crust("tool").command("build", { description: "Build the project" }, (command) =>
	command.flags({ minify: { type: "boolean" } }).action(({ flags, stdout }) => {
		stdout(`minify: ${flags.minify ?? false}`);
		//                      ^?
	}),
);

await tool.execute();
