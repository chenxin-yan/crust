import { Crust } from "@crustjs/core";

//#region validation
export const declared = new Crust("greet")
	.flags({
		name: {
			type: "string",
			// [!code highlight:2]
			required: true,
			choices: ["Ada", "Grace"],
		},
	})
	.action(({ flags, stdout }) => stdout(`Hello, ${flags.name}`));
//#endregion

//#region cleanup
import { defineContext } from "@crustjs/core";

const database = defineContext("database").setup(({ stderr }) => ({
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

//#region error-class
import { readFile } from "node:fs/promises";

// [!code highlight:3]
export class ConfigNotFoundError extends Error {
	override name = "ConfigNotFoundError";
}

async function loadConfig(path: string) {
	try {
		return await readFile(path, "utf8");
	} catch (cause) {
		// Only a missing file means "run init"; rethrow permission and other failures as is.
		if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
		// [!code highlight]
		throw new ConfigNotFoundError(`No ${path} found. Run \`app init\` to create one.`, { cause });
	}
}

const configured = new Crust("app").action(async () => {
	await loadConfig("app.config.json");
});
//#endregion

const cancelled = new Crust("app").action(() => {
	throw new DOMException("Cancelled", "AbortError");
});
async function inspectFailure() {
	//#region tests
	const outcome = await configured.run([]);
	if (outcome.status === "failed" && outcome.error instanceof ConfigNotFoundError) {
		console.log(outcome.error.message); // No app.config.json found. Run `app init` to create one.
	}
	//#endregion
}

if (import.meta.main) {
	const example = {
		validate: declared,
		cleanup: deploy,
		config: configured,
		cancel: cancelled,
		prompt: prompted,
	}[process.argv[2] ?? ""];
	if (example) await example.execute({ argv: process.argv.slice(3) });
	else if (process.argv[2] === "inspect") await inspectFailure();
}
