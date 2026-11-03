import { Crust, defineCommand, defineFlag } from "@crustjs/core";

// [!code highlight]
const format = defineFlag({ type: "string", default: "json" });
const print = defineCommand("print", (command) =>
	command.flags({ format }).action(({ flags, stdout }) => stdout(`print as ${flags.format}`)),
);
const inspect = defineCommand("inspect", (command) =>
	command.flags({ format }).action(({ flags, stdout }) => stdout(`inspect as ${flags.format}`)),
);

await new Crust("tools").add(print, inspect).execute();
