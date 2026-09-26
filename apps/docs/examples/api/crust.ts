// #region define
import { Crust, defineCommand, defineContext, defineFlag } from "@crustjs/core";

const verbose = defineFlag("verbose", { type: "boolean" });
const logging = defineContext("logging")
	.flags(verbose)
	.setup(({ flags, stderr }) => ({
		debug(message: string) {
			if (flags.verbose) stderr(message);
		},
	}));
const auth = defineContext("auth").setup(() => ({ user: "Ada" }));

// Inert until added; `.use()` declares the Contexts this command needs.
const deploy = defineCommand("deploy", { description: "Deploy an application" }, (command) =>
	command
		.use(logging, auth)
		.args({ name: "target", type: "string", required: true })
		.action(async ({ args, ctx, stdout }) => {
			(await ctx.logging).debug(`deploying ${args.target}`);
			stdout(`${(await ctx.auth).user} deployed ${args.target}`);
		}),
);
// #endregion define

// #region root
import { help, version } from "@crustjs/extensions";

const app = new Crust("my-cli", { description: "Deploy tool", version: "1.2.3" })
	.provide(logging(), auth()) // providers must precede the definitions that use them
	.add(deploy, deploy.as("ship"))
	.command("status", (command) => command.action(({ stdout }) => stdout("ok")))
	.extend(version(), help());
// #endregion root

// #region run
const outcome = await app.run(["deploy"], { args: { target: "prod" }, flags: { verbose: true } });
if (outcome.status === "failed") throw outcome.error;
if (outcome.status === "completed") console.log(outcome.stdout); // => Ada deployed prod
// #endregion run

// #region at
const ship = app.at(["ship"]);
const shipped = await ship.run({ args: { target: "staging" } });
console.log(shipped.status); // => completed
// #endregion at

// #region execute
const sync = new Crust("sync").action(async ({ signal, stdout }) => {
	const response = await fetch("https://example.com/export", { signal });
	stdout(await response.text());
});

await sync.execute(); // Ctrl-C → exit code 130, nothing rendered
// #endregion execute

// #region artifact
import { readdirSync } from "node:fs";

import { resolveArtifactDir } from "@crustjs/core";

const templates = readdirSync(resolveArtifactDir("templates"));
// #endregion artifact

export { app, templates };
