import { Crust } from "@crustjs/core";

const serve = new Crust("serve")
	.flags({
		// [!code highlight:2]
		target: { type: "string", multiple: true, short: "t" },
		runtime: { type: "string", choices: ["bun", "node"], default: "bun" },
		tag: { type: "string" },
	})
	.action(({ flags, stdout }) => {
		//         ^?
		stdout(
			`targets=${flags.target?.join(",") ?? "undefined"} runtime=${flags.runtime} tag=${String(flags.tag)}`,
		);
	});

await serve.execute();
