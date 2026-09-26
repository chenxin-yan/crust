import { Crust } from "@crustjs/core";

//#region validation
export const declared = new Crust("greet")
	.flags({
		name: "name",
		type: "string",
		// [!code highlight:2]
		required: true,
		choices: ["Ada", "Grace"],
	})
	.action(({ flags, stdout }) => stdout(`Hello, ${flags.name}`));
//#endregion

//#region cleanup
import { defineContext } from "@crustjs/core";

const database = defineContext("database", ({ stderr }) => ({
	// [!code highlight:2]
	[Symbol.dispose]() {
		stderr("Closed database");
	},
}));
function deployRelease() {
	throw new Error("Deployment service is unavailable. Try again later.");
}
export const deploy = new Crust("deploy").provide(database()).action(async ({ ctx }) => {
	// [!code highlight:2]
	await ctx.database;
	deployRelease();
});
//#endregion

//#region cancellation
import { mkdir, writeFile } from "node:fs/promises";

import { input } from "@crustjs/prompts";

async function createProject() {
	const name = await input({ message: "Project name?" });
	await mkdir(name);
	await writeFile(`${name}/package.json`, "{}");
}

const prompted = new Crust("scaffold").action(createProject);
//#endregion

//#region custom-message
import { defineExtension, defineExtensionId } from "@crustjs/core";

class ConfigError extends Error {}

const configErrors = defineExtension(defineExtensionId("config-errors")).onError(
	(error, { stderr }) => {
		// [!code highlight]
		if (!(error instanceof ConfigError)) return;
		stderr(`Error: ${error.message}`);
		stderr("Hint: Run init to create the config file.");
		// [!code highlight]
		return true;
	},
);

const configured = new Crust("app").extend(configErrors).action(() => {
	throw new ConfigError("Config file not found.");
});
//#endregion

const cancelled = new Crust("app").action(() => {
	throw new DOMException("Cancelled", "AbortError");
});
async function inspectFailure() {
	//#region tests
	const outcome = await configured.run([]);
	if (outcome.status === "failed" && outcome.error instanceof ConfigError) {
		console.log(outcome.error.message); // Config file not found.
	}
	//#endregion
}

if (import.meta.main) {
	const example = {
		validate: declared,
		cleanup: deploy,
		custom: configured,
		cancel: cancelled,
		prompt: prompted,
	}[process.argv[2] ?? ""];
	if (example) await example.execute({ argv: process.argv.slice(3) });
	else if (process.argv[2] === "inspect") await inspectFailure();
}
