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
			// One local append: the command waits for no network. The modes apply when the
			// directory and the file are created, so only the user can read the queue.
			send: async (event) => {
				await mkdir(dirname(queue), { recursive: true, mode: 0o700 });
				await appendFile(queue, `${JSON.stringify(event)}\n`, { mode: 0o600 });
			},
		}),
	)
	.add(defineCommand("deploy", (command) => command.action(() => {})));

await app.execute();
