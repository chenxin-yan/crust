import { Crust, defineCommand, type AnyCrust } from "./crust.ts";

function _commandNames() {
	// @ts-expect-error -- reusable commands share canonical-name restrictions
	defineCommand("__proto__", (command) => command);
	// @ts-expect-error -- whitespace-only names cannot route
	defineCommand(" \t", {}, (command) => command);
	const command = defineCommand("valid", (builder) => builder);
	// @ts-expect-error -- renaming cannot introduce a reserved canonical name
	command.as("__proto__");
	// @ts-expect-error -- renaming cannot introduce a blank canonical name
	command.as("\n");
	// @ts-expect-error -- inline commands share canonical-name restrictions
	new Crust("root").command("__proto__", (builder) => builder);
	defineCommand("two words", (builder) => builder);
	defineCommand("-leading", (builder) => builder);
}

function _constructorNames(invalidName: "" | "valid") {
	// @ts-expect-error -- blank literal root names cannot route
	new Crust("");
	// @ts-expect-error -- whitespace-only root names match trim validation
	new Crust(" \t\n");
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
