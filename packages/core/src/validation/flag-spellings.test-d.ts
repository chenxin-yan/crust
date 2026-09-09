import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { Crust, defineCommand } from "../command/crust.ts";
import { defineExtensionId } from "../identity.ts";

function _ownFlagSpellings() {
	// @ts-expect-error -- duplicate long aliases are checked before union extraction
	new Crust("cli").flags({ name: "flag", type: "boolean", aliases: ["again", "again"] });
	// @ts-expect-error -- short and long aliases share the spelling namespace
	new Crust("cli").flags({ name: "flag", type: "boolean", short: "f", aliases: ["f"] });
	// @ts-expect-error -- short aliases contain exactly one UTF-16 code unit
	new Crust("cli").flags({ name: "flag", type: "boolean", short: "many" });
	defineContext(
		"context",
		// @ts-expect-error -- Context flags use the same local spelling contract
		{ flags: [{ name: "flag", type: "boolean", aliases: ["f", "f"] }] },
		() => true,
	);
	defineExtension(defineExtensionId("extension"), {
		// @ts-expect-error -- Extension flags use the same local spelling contract
		flags: [{ name: "flag", type: "boolean", short: "ff" }],
	});
	defineCommand("child", (command) =>
		command
			// @ts-expect-error -- recipe flags use the same local spelling contract
			.flags({ name: "flag", type: "boolean", aliases: ["f", "f"] }),
	);
	new Crust("cli").flags({ name: "flag", type: "boolean", short: "f", aliases: ["again"] });
}
