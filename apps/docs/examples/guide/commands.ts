import { Crust } from "@crustjs/core";

// [!code highlight]
const tool = new Crust("tool").command("build", (command) =>
	command
		// [!code highlight]
		.flags({ name: "minify", type: "boolean" })
		.action(({ flags, stdout }) => {
			stdout(`minify: ${flags.minify ?? false}`);
			//                      ^?
		}),
);

await tool.execute();
