import { Crust } from "@crustjs/core";
import { input } from "@crustjs/prompts";
import { captureExecute, withEnv } from "@crustjs/testing";
import { runInteractive } from "@crustjs/testing/interactive";

const app = new Crust("my-cli")
	.command("greet", (command) =>
		command.action(async ({ stdout }) => {
			const name = await input({ message: "Name?" });
			stdout(`Hello, ${name}`);
		}),
	)
	.command("whoami", (command) =>
		command
			.flags({ token: { type: "string", env: "MY_CLI_TOKEN" } })
			.action(({ flags }) => flags.token),
	);

//#region execute
const captured = await captureExecute(app, ["unknown"]);
console.log(captured.exitCode); // 2
console.log(JSON.stringify(captured.stderr)); // "Error: Unknown command \"unknown\".\n"
//#endregion

//#region env
// Nothing from the shell: no MY_CLI_TOKEN, HOME, or XDG_CONFIG_HOME.
await captureExecute(app, ["whoami"], { env: {} });
// The shell's variables with one changed and one removed, run from a fixture folder.
await captureExecute(app, ["whoami"], {
	env: { ...process.env, MY_CLI_TOKEN: "test-token", NO_COLOR: undefined },
	cwd: "fixtures/project",
});
//#endregion

//#region with-env
const outcome = await withEnv({ MY_CLI_TOKEN: "test-token" }, () => app.run(["whoami"]));
if (outcome.status === "completed") console.log(outcome.result); // test-token
//#endregion

//#region interactive
const run = runInteractive(app, ["greet"]);
await run.waitFor(/Name/);
run.type("Ada");
run.keys("return");
const { stdout, exitCode } = await run.done;
console.log(run.screen()); // ✓ Name? Ada
console.log(JSON.stringify(stdout), exitCode); // "Hello, Ada\n" 0
//#endregion
