import { Crust, defineCommand } from "@crustjs/core";
import { writeProcessOutput } from "@crustjs/utils/terminal";

import { telemetry } from "../src/telemetry.ts";

// Every event `send` receives goes to stderr, so the test sees what each process sent.
const app = new Crust("acme")
	.extend(
		telemetry({
			env: "ACME_TELEMETRY",
			enabled: "opt-out",
			send: async (event) => {
				writeProcessOutput(2, `sent ${event.command.join(" ")}\n`);
			},
		}),
	)
	.add(defineCommand("deploy", (cmd) => cmd.action(() => {})));

await app.execute();
