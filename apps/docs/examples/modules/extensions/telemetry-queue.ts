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
			// One local append: the command waits for no network.
			send: async (event) => {
				await mkdir(dirname(queue), { recursive: true });
				await appendFile(queue, `${JSON.stringify(event)}\n`);
			},
		}),
	)
	.add(defineCommand("deploy", (command) => command.action(() => {})));

await app.execute();
