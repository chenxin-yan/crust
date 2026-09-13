import { expect, test } from "bun:test";

import { Crust } from "@crustjs/core";
import { input } from "@crustjs/prompts";
import { captureExecute, runInteractive } from "@crustjs/testing";

//#region run
const app = new Crust("app").action(({ stdout }) => {
  stdout("first\nsecond");
  return 3;
});

test("returns output and the action result", async () => {
  const outcome = await app.run([]);

  expect(outcome.stdout).toBe("first\nsecond");
  expect(outcome.status).toBe("completed");
  if (outcome.status === "completed") expect(outcome.result).toBe(3);
});
//#endregion

//#region capture-execute
test("captures terminal errors", async () => {
  const result = await captureExecute(app, ["--unknown"]);

  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Unknown flag");
  expect(result.exitCode).toBe(1);
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
  await run.done;

  expect(run.screen()).toContain("Name? Ada");
  expect(run.screen()).toContain("Hello, Ada!");
});
//#endregion
