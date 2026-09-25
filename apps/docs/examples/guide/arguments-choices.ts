import { Crust } from "@crustjs/core";

const run = new Crust("run")
	// [!code highlight]
	.args({ name: "runtime", type: "string", choices: ["bun", "node"] })
	.action(({ args, stdout }) => {
		const runtime = args.runtime;
		//    ^?
		stdout(`runtime: ${runtime}`);
	});

await run.execute();
