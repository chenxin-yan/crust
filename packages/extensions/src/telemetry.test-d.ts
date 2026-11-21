import { Crust, defineCommand } from "@crustjs/core";

import { telemetry } from "./telemetry.ts";

function _telemetryOptions() {
	const send = async () => {};
	new Crust("app").extend(telemetry({ env: "APP_TELEMETRY", enabled: "opt-in", send }));
	new Crust("app").extend(
		telemetry({
			env: "APP_TELEMETRY",
			enabled: "opt-out",
			send: async (event, { signal }) => {
				const aborted: boolean = signal.aborted;
				const command: readonly string[] = event.command;
				const outcome: "completed" | "failed" | "handled" = event.outcome;
				const numbers: number = event.durationMs;
				const ci: boolean = event.ci;
				void [aborted, command, outcome, numbers, ci];
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

function host() {
	const deploy = defineCommand("deploy", (command) =>
		command.flags({ force: { type: "boolean" } }).action(() => {}),
	);
	return new Crust("acme").add(deploy);
}
const send = async () => {};

// The default `telemetry` command keeps the host's command tree closed and returns the state.
async function _telemetryDefaultCommand() {
	const app = host().extend(telemetry({ env: "ACME_TELEMETRY", enabled: "opt-out", send }));
	void app.run(["deploy"], { flags: { force: true } });
	const outcome = await app.run(["telemetry"]);
	if (outcome.status === "completed") {
		const sending: boolean = outcome.result.sending;
		const decidedBy: "do-not-track" | "env" | "saved" | "default" = outcome.result.decidedBy;
		const saved: "on" | "off" | "unreadable" | undefined = outcome.result.saved;
		const fallback: "on" | "off" = outcome.result.default;
		void [sending, decidedBy, saved, fallback];
	}
	for (const run of [
		await app.run(["telemetry", "status"]),
		await app.run(["telemetry", "enable"]),
		await app.run(["telemetry", "disable"]),
	]) {
		if (run.status === "completed") void (run.result.sending satisfies boolean);
	}
	// @ts-expect-error -- unknown command paths stay rejected after extend()
	void app.run(["telemetry", "reset"]);
	// @ts-expect-error -- unknown flags on host commands stay rejected
	void app.run(["deploy"], { flags: { forse: true } });
	void host()
		.extend(telemetry({ env: "ACME_TELEMETRY", enabled: "opt-out", send, command: undefined }))
		.run(["telemetry"]);
}

// A literal `command` renames it without opening the tree.
function _telemetryLiteralCommand() {
	const app = host().extend(
		telemetry({ env: "ACME_TELEMETRY", enabled: "opt-out", send, command: "analytics" }),
	);
	void app.run(["analytics", "disable"]);
	// @ts-expect-error -- the default name is gone once renamed
	void app.run(["telemetry"]);
	// @ts-expect-error -- unknown command paths stay rejected after extend()
	void app.run(["deplyo"]);
}

// A name only known at runtime cannot be keyed statically, so the tree stays open.
function _telemetryDynamicCommand(command: string, options: { command?: "analytics" }) {
	const app = host().extend(
		telemetry({ env: "ACME_TELEMETRY", enabled: "opt-out", send, command }),
	);
	void app.run([command]);
	void app.run(["deploy"], { flags: { force: true } });
	// An optional literal may be absent at runtime, so the tree stays open too.
	void host()
		.extend(telemetry({ env: "ACME_TELEMETRY", enabled: "opt-out", send, ...options }))
		.run(["telemetry"]);
	// @ts-expect-error -- the command is a name, not a path
	telemetry({ env: "ACME_TELEMETRY", enabled: "opt-out", send, command: ["admin", "telemetry"] });
}
