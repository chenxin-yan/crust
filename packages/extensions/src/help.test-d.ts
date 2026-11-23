import { Crust } from "@crustjs/core";

import { help } from "./help.ts";

async function _helpCommandIsTypedOnlyWhenAdded() {
	await new Crust("app")
		.extend(help({ command: true }))
		.run(["help"], { args: { command: ["db"] } });
	// @ts-expect-error help() adds no `help` command.
	await new Crust("app").extend(help()).run(["help"]);
	const flag: boolean = Math.random() > 0.5;
	// @ts-expect-error Whether the command exists must be known.
	new Crust("app").extend(help({ command: flag }));
}
