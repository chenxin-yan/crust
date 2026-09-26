import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";

const app = new Crust("cli").command("greet", (command) =>
	command.action(({ stdout }) => stdout("Hello")),
);

// [!code highlight]
const captured = await captureExecute(app, ["unknown"]);
console.log(captured.exitCode);
//                   ^?
console.log(captured.stderr);
//                   ^?
