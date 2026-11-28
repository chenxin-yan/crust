//#region run
// @types: bun
import { expect, test } from "bun:test";

import { Crust } from "@crustjs/core";
import { input } from "@crustjs/prompts";
import { captureExecute, withEnv } from "@crustjs/testing";
import { runInteractive } from "@crustjs/testing/interactive";
// ---cut---
const app = new Crust("app").action(({ stdout }) => {
	stdout("first\nsecond");
	return 3;
});

test("returns output and the action result", async () => {
	const outcome = await app.run([]);
	//    ^?

	expect(outcome.stdout).toBe("first\nsecond\n");
	expect(outcome.status).toBe("completed");
	// [!code highlight]
	if (outcome.status === "completed") {
		expect(outcome.result).toBe(3);
		//             ^?
	}
});
//#endregion

//#region env
const whoami = new Crust("whoami")
	.flags({ token: { type: "string", env: "APP_TOKEN" } })
	.action(({ flags, stdout }) => {
		stdout(flags.token ?? "anonymous");
		return flags.token;
	});

test("reads its token from the environment the test sets", async () => {
	// An empty environment: nothing from the shell running the tests.
	expect(await captureExecute(whoami, [], { env: {} })).toEqual({
		stdout: "anonymous\n",
		stderr: "",
		exitCode: 0,
	});
	// A typed run() keeps its typed result inside withEnv().
	const outcome = await withEnv({ APP_TOKEN: "t0ken" }, () => whoami.run([]));
	expect(outcome).toMatchObject({ status: "completed", result: "t0ken" });
});
//#endregion

//#region capture-execute
test("captures terminal errors", async () => {
	const result = await captureExecute(app, ["--unknown"]);

	expect(result.stdout).toBe("");
	// [!code highlight:2]
	expect(result.stderr).toBe('Error: Unknown flag "--unknown"\n');
	expect(result.exitCode).toBe(2);
});
//#endregion

//#region interactive
const greeting = new Crust("greet").action(async ({ stderr }) => {
	const name = await input({ message: "Name?" });
	stderr(`Hello, ${name}!`);
});

test("drives a prompt", async () => {
	const run = runInteractive(greeting, []);
	await run.waitFor(/Name\?/);
	run.type("Ada");
	run.keys("return");

	expect(await run.done).toEqual({ stdout: "", stderr: "Hello, Ada!\n", exitCode: 0 });
	expect(run.screen()).toContain("Name? Ada");
});
//#endregion
