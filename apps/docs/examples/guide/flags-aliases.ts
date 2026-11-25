import { Crust } from "@crustjs/core";

const serve = new Crust("serve")
	// [!code highlight]
	.flags({ color: { type: "boolean", short: "c", aliases: ["colour"], negatable: true } })
	.action(({ flags, stdout }) => {
		stdout(`color=${String(flags.color)}`);
	});

await serve.execute();
