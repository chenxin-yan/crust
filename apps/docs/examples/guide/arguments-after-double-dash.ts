import { Crust } from "@crustjs/core";

const run = new Crust("run")
	.args(
		{ name: "task", type: "string", required: true },
		{ name: "packages", type: "string", variadic: true },
		// [!code highlight]
		{ name: "extra", type: "string", variadic: true, afterDoubleDash: true },
	)
	.action(({ args, stdout }) => {
		const extra = args.extra;
		//    ^?
		stdout(`${args.task} in ${args.packages.join(", ")}: ${extra.join(" ")}`);
	});

await run.execute();
