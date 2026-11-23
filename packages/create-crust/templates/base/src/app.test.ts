import assert from "node:assert/strict";
import { test } from "node:test";

import { captureExecute } from "@crustjs/testing";

import { app } from "./app.ts";

test("greets by name", async () => {
	const { stdout, exitCode } = await captureExecute(app, ["Ada", "--greet", "Hi"]);

	assert.equal(exitCode, 0);
	assert.equal(stdout.trim(), "Hi, Ada!");
});
