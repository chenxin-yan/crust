import { defineExtension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import { Crust, defineCommand, type AnyCrust } from "./crust.ts";

// Definition names are type-checked where `.add()` consumes them, so generic factories compile.
function _commandNames() {
	const app = new Crust("root");
	const extension = defineExtension(defineExtensionId("names"));
	// @ts-expect-error -- reusable commands share canonical-name restrictions
	app.add(defineCommand("__proto__", (command) => command));
	// @ts-expect-error -- whitespace-only names cannot route
	app.add(defineCommand(" \t", {}, (command) => command));
	// @ts-expect-error -- statically blank name
	app.add(defineCommand("\v", (command) => command));
	// @ts-expect-error -- Extension commands share canonical-name restrictions
	extension.add(defineCommand("__proto__", (command) => command));
	const command = defineCommand("valid", (builder) => builder);
	// @ts-expect-error -- renaming cannot introduce a reserved canonical name
	app.add(command.as("__proto__"));
	// @ts-expect-error -- renaming cannot introduce a blank canonical name
	app.add(command.as("\n"));
	// @ts-expect-error -- statically blank name
	app.add(command.as("\u2003"));
	// @ts-expect-error -- Extension commands share canonical-name restrictions
	extension.add(command.as("\n"));
	// @ts-expect-error -- inline commands share canonical-name restrictions
	new Crust("root").command("__proto__", (builder) => builder);
}

// Child names are argv tokens; a literal that cannot be one fails before runtime.
function _childNameShape(dynamic: string, mixed: "-x" | `mode-${string}`) {
	const app = new Crust("root");
	const command = defineCommand("valid", (builder) => builder);
	// @ts-expect-error -- leading dash reads as a flag
	app.add(defineCommand("-x", (builder) => builder));
	// @ts-expect-error -- leading dash reads as a flag
	app.add(defineCommand("--x", {}, (builder) => builder));
	// @ts-expect-error -- whitespace splits the argv token
	app.add(defineCommand("my cmd", (builder) => builder));
	// @ts-expect-error -- whitespace splits the argv token
	app.add(defineCommand("my\tcmd", (builder) => builder));
	// @ts-expect-error -- Extension commands are argv tokens too
	defineExtension(defineExtensionId("shape")).add(defineCommand("-x", (builder) => builder));
	// @ts-expect-error -- leading dash reads as a flag
	new Crust("root").command("-x", (builder) => builder);
	// @ts-expect-error -- whitespace splits the argv token
	new Crust("root").command("my cmd", (builder) => builder);
	// @ts-expect-error -- leading dash reads as a flag
	app.add(command.as("--x"));
	// @ts-expect-error -- whitespace splits the argv token
	app.add(command.as("de\tploy"));
	// @ts-expect-error -- an open member does not hide a literal flag-shaped member
	app.add(defineCommand(mixed, (builder) => builder));
	app.add(defineCommand(dynamic, (builder) => builder));
	new Crust("root").command(dynamic, (builder) => builder);
	app.add(command.as(dynamic));
	app.add(defineCommand("x-y", (builder) => builder));
}

// An open template member does not hide an independently invalid literal member (#357).
function _mixedOpenNames(
	empty: "" | `mode-${string}`,
	reserved: "__proto__" | `mode-${string}`,
	valid: "fixed" | `mode-${string}`,
	dashAlias: "-a" | `x-${string}`,
) {
	const app = new Crust("root");
	const command = defineCommand("valid", (builder) => builder);
	// @ts-expect-error -- blank member cannot route
	new Crust(empty);
	// @ts-expect-error -- reserved member
	new Crust(reserved);
	// @ts-expect-error -- blank member cannot route
	app.add(defineCommand(empty, (builder) => builder));
	// @ts-expect-error -- reserved member
	app.add(defineCommand(reserved, (builder) => builder));
	// @ts-expect-error -- blank member cannot route
	new Crust("root").command(empty, (builder) => builder);
	// @ts-expect-error -- reserved member
	new Crust("root").command(reserved, (builder) => builder);
	// @ts-expect-error -- renaming cannot introduce a blank member
	app.add(command.as(empty));
	// @ts-expect-error -- renaming cannot introduce a reserved member
	app.add(command.as(reserved));
	// @ts-expect-error -- empty alias member
	defineCommand("x", { aliases: ["", valid] }, (builder) => builder);
	// @ts-expect-error -- leading-dash alias member
	defineCommand("x", { aliases: [dashAlias] }, (builder) => builder);
	new Crust(valid);
	app.add(defineCommand(valid, (builder) => builder));
	defineCommand("x", { aliases: [valid] }, (builder) => builder);
	app.add(command.as(valid));
}

function _constructorNames(invalidName: "" | "valid") {
	// @ts-expect-error -- blank literal root names cannot route
	new Crust("");
	// @ts-expect-error -- whitespace-only root names match trim validation
	new Crust(" \t\n");
	// @ts-expect-error -- statically blank name
	new Crust("\u00a0");
	// @ts-expect-error -- reserved record key
	new Crust("__proto__");
	// @ts-expect-error -- one valid branch cannot hide an invalid root name
	new Crust(invalidName);
	new Crust("two words");
	new Crust("-leading");
	const broad: Crust = new Crust("literal");
	const anyCrust: AnyCrust = new Crust("literal");
	function identity<T extends AnyCrust>(app: T): T {
		return app;
	}
	identity(new Crust("literal").flags({ ok: { type: "boolean" } }));
	void [broad, anyCrust];
}
