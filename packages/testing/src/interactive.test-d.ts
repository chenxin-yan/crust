import { Crust } from "@crustjs/core";

import type { CapturedExecute } from "./capture.ts";
import { runInteractive } from "./interactive.ts";

// Compile-time regression checks; intentionally never invoked.
async function _typecheckKeysAndDone() {
	const app = new Crust("cli").command("ask", (command) => command.action(() => {}));
	const run = runInteractive(app, ["ask", "--verbose"], { env: {}, cwd: "fixtures", raw: true });
	run.keys("return", "down", "space", "ctrl+c", "ctrl+d");
	// @ts-expect-error -- a misspelled key name is a compile error, not a runtime throw
	run.keys("entr");
	// @ts-expect-error -- text goes through type(), not keys()
	run.keys("y");
	// @ts-expect-error -- ctrl takes one letter
	run.keys("ctrl+enter");
	run.resize(40, 10);
	run.cancel();
	const result: CapturedExecute = await run.done;
	return result;
}

void _typecheckKeysAndDone;
