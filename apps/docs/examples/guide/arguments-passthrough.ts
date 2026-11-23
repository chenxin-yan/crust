import { Crust } from "@crustjs/core";

const run = new Crust("run")
	.flags({ rm: { type: "boolean", description: "Remove the container when it exits" } })
	.args(
		{ name: "image", type: "string", required: true },
		// [!code highlight]
		{ name: "command", type: "string", variadic: "passthrough" },
	)
	.action(({ args, flags, stdout }) => {
		const command = args.command;
		//    ^?
		stdout(`${args.image}${flags.rm ? " (--rm)" : ""}: ${command.join(" ")}`);
	});

await run.execute();
