import { Crust } from "@crustjs/core";

import { telemetry } from "./telemetry.ts";

function _telemetryOptions() {
	const send = async () => {};
	new Crust("app").extend(telemetry({ env: "APP_TELEMETRY", enabled: "opt-in", send }));
	new Crust("app").extend(
		telemetry({
			env: "APP_TELEMETRY",
			enabled: "opt-out",
			send: async (event) => {
				const command: readonly string[] = event.command;
				const outcome: "completed" | "failed" | "handled" = event.outcome;
				const numbers: number = event.durationMs;
				const ci: boolean = event.ci;
				void [command, outcome, numbers, ci];
			},
		}),
	);
	// @ts-expect-error The app chooses opt-in or opt-out; there is no default.
	telemetry({ env: "APP_TELEMETRY", send });
	// @ts-expect-error The environment variable is the user's only switch.
	telemetry({ enabled: "opt-out", send });
	// @ts-expect-error Only "opt-in" and "opt-out".
	telemetry({ env: "APP_TELEMETRY", enabled: true, send });
	// @ts-expect-error The app supplies send; Crust has no network code.
	telemetry({ env: "APP_TELEMETRY", enabled: "opt-in" });
	// @ts-expect-error Options are required.
	telemetry();
}
