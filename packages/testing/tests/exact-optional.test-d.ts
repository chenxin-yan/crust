// Compiled by `tsconfig.exact.json` with `exactOptionalPropertyTypes`, as a consumer would:
// every app `execute()` accepts is one `captureExecute()` accepts.
import { Crust } from "@crustjs/core";

import { captureExecute } from "../src/index.ts";

declare const maybeEnv: Record<string, string | undefined> | undefined;
declare const maybeRaw: boolean | undefined;

const app = new Crust("tool").command("deploy", (command) =>
	command.action(({ stdout }) => stdout("deployed")),
);

async function _capturesAnApp() {
	const result = await captureExecute(app, ["deploy"]);
	const code: number = result.exitCode;
	await captureExecute(app, ["deploy"], { env: {} });
	// Options filled from optional values accept an explicit `undefined`.
	await captureExecute(app, ["deploy"], { env: maybeEnv, raw: maybeRaw });
	return code;
}

void _capturesAnApp;
