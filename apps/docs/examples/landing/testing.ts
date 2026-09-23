import { Crust } from "@crustjs/core";
import { input } from "@crustjs/prompts";
import { captureExecute } from "@crustjs/testing";
import { runInteractive } from "@crustjs/testing/interactive";

const app = new Crust("my-cli").command(
	"greet",
	(command) =>
		command.action(async ({ stdout }) => {
			const name = await input({ message: "Name?" });
			stdout(`Hello, ${name}`);
		}),
);

// Runs argv in-process and captures the result
const captured = await captureExecute(app, ["unknown"]);
console.log(captured.exitCode);
console.log(captured.stderr);

// Drives prompts on a fake terminal
const run = runInteractive(app, ["greet"]);
await run.waitFor(/Name/);
run.type("Ada");
run.keys("return");
await run.done;
console.log(run.screen());
