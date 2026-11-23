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

//#region exit-code
// Like `grep`: 0 when a line matches, 1 when none does, 2 for a usage error.
export const search = new Crust("search")
	.args(
		{ name: "pattern", type: "string", required: true },
		{ name: "lines", type: "string", variadic: true },
	)
	.action(({ args, stdout, exitCode }) => {
		const matches = args.lines.filter((line) => line.includes(args.pattern));
		for (const line of matches) stdout(line);
		// [!code highlight]
		if (matches.length === 0) exitCode(1);
	});
//#endregion

//#region debug
import { defineExtension, defineExtensionId } from "@crustjs/core";

export const debug = defineExtension(defineExtensionId("acme:debug"))
	.flags({ debug: { type: "boolean", description: "Print errors with their stack and causes" } })
	// [!code highlight:12]
	.onError((error, { flags, stderr }) => {
		// A cancellation is not a bug: leave it to Crust.
		if (flags.debug !== true || (error instanceof Error && error.name === "AbortError")) return;
		// Stacks and messages only: other fields, such as a request's headers, can hold secrets.
		const printed = new Set<unknown>();
		for (let current: unknown = error; current !== undefined && !printed.has(current);) {
			const text = current instanceof Error ? (current.stack ?? current.message) : String(current);
			stderr(printed.size === 0 ? text : `Caused by: ${text}`);
			printed.add(current);
			current = current instanceof Error ? current.cause : undefined;
		}
		return true;
	});

const traced = new Crust("app").extend(debug).action(async () => {
	await loadConfig("app.config.json");
});
//#endregion

//#region quiet
import { defineCommand } from "@crustjs/core";

// [!code highlight:10]
const quiet = defineContext("quiet")
	.flags({
		quiet: {
			type: "boolean",
			short: "q",
			negatable: true,
			description: "Print less",
			env: "APP_QUIET",
		},
	})
	.setup(({ flags }) => flags.quiet === true);

const publish = defineCommand("publish", (command) =>
	command.use(quiet).action(async ({ ctx, stdout }) => {
		if (!(await ctx.quiet)) stdout("Uploading 3 files..."); // [!code highlight]
		stdout("Published v1.2.0");
	}),
);

const quieted = new Crust("app").provide(quiet()).add(publish);
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
		search,
		debug: traced,
		quiet: quieted,
		cancel: cancelled,
		prompt: prompted,
	}[process.argv[2] ?? ""];
	if (example) await example.execute({ argv: process.argv.slice(3) });
	else if (process.argv[2] === "inspect") await inspectFailure();
}
