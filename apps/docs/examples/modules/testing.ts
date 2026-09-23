import { Crust, defineCommand } from "@crustjs/core";
import { input } from "@crustjs/prompts";
import { captureExecute, fuzzRoundTrip } from "@crustjs/testing";
import { runInteractive } from "@crustjs/testing/interactive";

const app = new Crust("my-cli").add(
	defineCommand("greet", (command) =>
		command.action(async ({ stdout }) => {
			const name = await input({ message: "Name?" });
			stdout(`Hello, ${name}`);
		}),
	),
	defineCommand("deploy", (command) =>
		command
			.args({ name: "target", type: "string", required: true })
			.flags({ name: "tag", type: "string", multiple: true }, { name: "config", type: "json" })
			.action(() => {}),
	),
);

//#region execute
const captured = await captureExecute(app, ["unknown"]);
console.log(captured.exitCode); // 1
console.log(captured.stderr); // Error: Unknown command "unknown".
//#endregion

//#region fuzz
const report = await fuzzRoundTrip(app, ["deploy"], { runs: 200, seed: 42 });
console.log(report); // { seed: 42, runs: 200, accepted: 200, rejected: 0 }
//#endregion

//#region interactive
const run = runInteractive(app, ["greet"]);
await run.waitFor(/Name/);
run.type("Ada");
run.keys("return");
await run.done;
console.log(run.screen()); // ✓ Name? Ada
//#endregion
