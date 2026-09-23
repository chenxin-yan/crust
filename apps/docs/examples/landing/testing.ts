import { Crust } from "@crustjs/core";
import { input } from "@crustjs/prompts";
import { captureExecute } from "@crustjs/testing";
import { runInteractive } from "@crustjs/testing/interactive";

const app = new Crust("cli").command("greet", (command) =>
	command.action(async ({ stdout }) => {
		stdout(`Hello, ${await input({ message: "Name?" })}`);
	}),
);

// [!code highlight]
const captured = await captureExecute(app, ["unknown"]);
console.log(captured.exitCode);
console.log(captured.stderr);

// [!code highlight]
const run = runInteractive(app, ["greet"]);
await run.waitFor(/Name/);
run.type("Ada");
run.keys("return");
await run.done;
console.log(run.screen());
