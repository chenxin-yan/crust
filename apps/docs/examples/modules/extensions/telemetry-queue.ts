import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";
import { telemetry } from "@crustjs/extensions";
import { stateDir } from "@crustjs/store";

const queue = join(stateDir("acme"), "telemetry.ndjson");

const app = new Crust("acme")
	.extend(
		telemetry({
			env: "ACME_TELEMETRY",
			enabled: "opt-in",
			// One local append: the command waits for no network. On Linux and macOS the modes make a
			// new directory and file readable by the user only.
			send: async (event) => {
				await mkdir(dirname(queue), { recursive: true, mode: 0o700 });
				await appendFile(queue, `${JSON.stringify(event)}\n`, { mode: 0o600 });
			},
		}),
	)
	.add(defineCommand("deploy", (command) => command.action(() => {})));

await app.execute();
