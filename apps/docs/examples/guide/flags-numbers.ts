import { Crust } from "@crustjs/core";

const serve = new Crust("serve")
	.flags({
		port: { type: "integer", min: 1, max: 65535, default: 3000 },
		ratio: { type: "number", min: 0, max: 1, default: 0.5 },
		verbose: { type: "count", short: "v" },
	})
	.action(({ flags, stdout }) => {
		//         ^?
		stdout(`port=${flags.port} ratio=${flags.ratio} verbose=${flags.verbose}`);
	});

await serve.execute();
