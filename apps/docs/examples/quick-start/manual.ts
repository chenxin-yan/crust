import { Crust } from "@crustjs/core";
import { help } from "@crustjs/extensions";

const app = new Crust("my-cli")
	.extend(help())
	.args({ name: "name", type: "string", default: "world" })
	.action(({ args, stdout }) => {
		stdout(`Hello, ${args.name}!`);
	});

await app.execute();
