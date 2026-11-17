import { Crust, defineCommand } from "@crustjs/core";
import { telemetry } from "@crustjs/extensions";

const app = new Crust("acme")
	.extend(
		telemetry({
			env: "ACME_TELEMETRY",
			enabled: "opt-in",
			send: async (event) => {
				await fetch("https://telemetry.acme.dev/events", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(event),
				});
			},
		}),
	)
	.add(defineCommand("deploy", (command) => command.action(() => {})));

await app.execute();
