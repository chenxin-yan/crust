// A key no definition has is a compile error at every entry point that takes a definition:
// a generic parameter would otherwise admit it, and the runtime ignores it.
import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineArg, defineFlag } from "../api/flags.ts";
import { Crust, defineCommand } from "../command/crust.ts";
import { defineExtensionId } from "../identity.ts";

{
	// defineFlag
	defineFlag({ type: "string", required: true });
	// @ts-expect-error `requried` is not a flag property
	defineFlag({ type: "string", requried: true });
	// @ts-expect-error argument-only properties are not flag properties
	defineFlag({ type: "string", variadic: true });
	// @ts-expect-error an unknown key set to `undefined` is still unknown
	defineFlag({ type: "string", requried: undefined });
	// @ts-expect-error a list mode is an argument's, not a flag's
	new Crust("tool").flags({ cmd: { type: "string", variadic: "passthrough" } });
}

{
	// The removed `afterDoubleDash` property: `variadic: "afterDoubleDash"` replaces it
	new Crust("tool").args({ name: "extra", type: "string", variadic: "afterDoubleDash" });
	// @ts-expect-error `afterDoubleDash` is not an argument property
	new Crust("tool").args({ name: "extra", type: "string", afterDoubleDash: true });
}

{
	// defineArg
	defineArg("target", { type: "string", required: true });
	// @ts-expect-error `requird` is not an argument property
	defineArg("target", { type: "string", requird: true });
	// @ts-expect-error flag-only properties are not argument properties
	defineArg("target", { type: "string", short: "t" });
	// @ts-expect-error `name` comes from the first parameter, even when set to `undefined`
	defineArg("target", { type: "string", name: undefined });
}

{
	// .flags(): inline, reused, and on an inline child
	const token = defineFlag({ type: "string" });
	new Crust("tool").flags({ token, mode: { type: "string", choices: ["a", "b"] } });
	// @ts-expect-error `chocies` is not a flag property
	new Crust("tool").flags({ mode: { type: "string", chocies: ["a", "b"] } });
	// @ts-expect-error a plain flag with a misspelled key
	new Crust("tool").flags({ verbose: { type: "boolean", descripton: "More output" } });
	// @ts-expect-error a misspelled key set to `undefined`
	new Crust("tool").flags({ out: { type: "string", requried: undefined } });
	new Crust("tool").command("deploy", (command) =>
		// @ts-expect-error `defualt` is not a flag property
		command.flags({ region: { type: "string", defualt: "us" } }),
	);
}

{
	// .args()
	new Crust("tool").args({ name: "target", type: "string", required: true });
	// @ts-expect-error `requird` is not an argument property
	new Crust("tool").args({ name: "target", type: "string", requird: true });
	// @ts-expect-error a misspelled key set to `undefined`
	new Crust("tool").args({ name: "target", type: "string", requird: undefined });
}

{
	// Context and Extension flags
	defineContext("db").flags({ url: { type: "string" } });
	// @ts-expect-error `evn` is not a flag property
	defineContext("db").flags({ url: { type: "string", evn: { name: "DB_URL" } } });
	const id = defineExtensionId("test:unknown-keys");
	defineExtension(id).flags({ trace: { type: "boolean", recursive: false } });
	// @ts-expect-error `recursiv` is not an Extension flag property
	defineExtension(id).flags({ trace: { type: "boolean", recursiv: false } });
}

{
	// Command config: a misspelled key beside a valid one
	defineCommand("deploy", { description: "Deploy", hidden: true }, (command) => command);
	// @ts-expect-error `hiden` is not a command property
	defineCommand("deploy", { description: "Deploy", hiden: true }, (command) => command);
	new Crust("tool").command("deploy", { description: "Deploy" }, (command) => command);
	// @ts-expect-error `descripton` is not a command property
	new Crust("tool").command("deploy", { descripton: "Deploy", hidden: true }, (command) => command);
}
