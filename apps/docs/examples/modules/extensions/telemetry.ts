//#region usage
import { Crust, defineCommand } from "@crustjs/core";
import { type TelemetryOptions, telemetry } from "@crustjs/extensions";

const app = new Crust("acme")
	.extend(
		telemetry({
			env: "ACME_TELEMETRY",
			enabled: "opt-in",
			send: async (event, { signal }) => {
				await fetch("https://telemetry.acme.dev/events", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(event),
					signal,
				});
			},
		}),
	)
	.add(defineCommand("deploy", (command) => command.action(() => {})));

await app.execute();
//#endregion

export function renamed(send: TelemetryOptions["send"]) {
	//#region command
	// `acme analytics`, `acme analytics enable`, `acme analytics disable`
	const cli = new Crust("acme").extend(
		telemetry({ env: "ACME_TELEMETRY", enabled: "opt-in", send, command: "analytics" }),
	);
	//#endregion
	return cli;
}
