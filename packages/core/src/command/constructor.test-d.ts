import { Crust, defineCommand, type AnyCrust } from "./crust.ts";

function _commandNames() {
	// @ts-expect-error -- reusable commands share canonical-name restrictions
	defineCommand("__proto__", (command) => command);
	// @ts-expect-error -- whitespace-only names cannot route
	defineCommand(" \t", {}, (command) => command);
	// @ts-expect-error -- statically blank name
	defineCommand("\v", (command) => command);
	const command = defineCommand("valid", (builder) => builder);
	// @ts-expect-error -- renaming cannot introduce a reserved canonical name
	command.as("__proto__");
	// @ts-expect-error -- renaming cannot introduce a blank canonical name
	command.as("\n");
	// @ts-expect-error -- statically blank name
	command.as("\u2003");
	// @ts-expect-error -- inline commands share canonical-name restrictions
	new Crust("root").command("__proto__", (builder) => builder);
	defineCommand("two words", (builder) => builder);
	defineCommand("-leading", (builder) => builder);
}

// An open template member does not hide an independently invalid literal member (#357).
function _mixedOpenNames(
	empty: "" | `mode-${string}`,
	reserved: "__proto__" | `mode-${string}`,
	valid: "fixed" | `mode-${string}`,
	dashAlias: "-a" | `x-${string}`,
) {
	const command = defineCommand("valid", (builder) => builder);
	// @ts-expect-error -- blank member cannot route
	new Crust(empty);
	// @ts-expect-error -- reserved member
	new Crust(reserved);
	// @ts-expect-error -- blank member cannot route
	defineCommand(empty, (builder) => builder);
	// @ts-expect-error -- reserved member
	defineCommand(reserved, (builder) => builder);
	// @ts-expect-error -- blank member cannot route
	new Crust("root").command(empty, (builder) => builder);
	// @ts-expect-error -- reserved member
	new Crust("root").command(reserved, (builder) => builder);
	// @ts-expect-error -- renaming cannot introduce a blank member
	command.as(empty);
	// @ts-expect-error -- renaming cannot introduce a reserved member
	command.as(reserved);
	// @ts-expect-error -- empty alias member
	defineCommand("x", { aliases: ["", valid] }, (builder) => builder);
	// @ts-expect-error -- leading-dash alias member
	defineCommand("x", { aliases: [dashAlias] }, (builder) => builder);
	new Crust(valid);
	defineCommand(valid, (builder) => builder);
	defineCommand("x", { aliases: [valid] }, (builder) => builder);
	command.as(valid);
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
	identity(new Crust("literal").flags({ name: "ok", type: "boolean" }));
	void [broad, anyCrust];
}
