// ────────────────────────────────────────────────────────────────────────────
// @crustjs/extensions — Telemetry's saved setting (loaded only when it is read or the command runs)
// ────────────────────────────────────────────────────────────────────────────

import { configDir, createStore } from "@crustjs/store";

import type { SavedSetting, TelemetryStatus } from "./telemetry.ts";

const FILE_NAME = "telemetry";

function settingStore(appName: string) {
	return createStore({
		// configDir rejects path separators; encodeURIComponent is injective, so distinct names never collide.
		dirPath: configDir(encodeURIComponent(appName)),
		name: FILE_NAME,
		// A rewrite replaces a damaged file instead of merging into it.
		pruneUnknown: true,
		fields: {
			telemetry: {
				type: "string",
				validate: (value) => {
					if (value !== "on" && value !== "off") throw new Error('Expected "on" or "off"');
				},
			},
		},
	});
}

/** The saved choice, `undefined` when nothing is saved, `"unreadable"` for any failure: it never throws. */
export async function readSavedSetting(appName: string): Promise<SavedSetting | undefined> {
	try {
		// SAFETY: the field's validator admits only "on" and "off".
		return (await settingStore(appName).read()).telemetry as "on" | "off" | undefined;
	} catch {
		return "unreadable";
	}
}

export async function writeSavedSetting(appName: string, setting: "on" | "off"): Promise<void> {
	await settingStore(appName).write({ telemetry: setting });
}

/**
 * The text the command prints. `change` is the choice `enable` or `disable` just saved;
 * `command` is the contributed command's name, which every hint spells as configured.
 */
export function describeStatus(
	status: TelemetryStatus,
	change: "on" | "off" | undefined,
	appName: string,
	command: string,
	env: string,
): string {
	const cli = `${appName} ${command}`;
	const state = status.sending ? "on" : "off";
	const variable =
		status.decidedBy === "do-not-track"
			? "DO_NOT_TRACK is set"
			: `${env}=${process.env[env] ?? ""} is set`;
	if (change !== undefined) {
		return status.sending === (change === "on")
			? `Telemetry is ${change} on this machine.`
			: `Telemetry is ${change} on this machine, but stays ${state} while ${variable}.`;
	}
	const lines =
		status.decidedBy === "do-not-track" || status.decidedBy === "env"
			? [`Telemetry is ${state} because ${variable}.`]
			: status.decidedBy === "default"
				? [
						`Telemetry is ${state}. This is the default.`,
						`Turn it ${status.sending ? "off" : "on"} with: ${cli} ${status.sending ? "disable" : "enable"}`,
					]
				: status.saved === "unreadable"
					? ["Telemetry is off."]
					: [
							`Telemetry is ${state}. You turned it ${state} with "${cli} ${status.sending ? "enable" : "disable"}".`,
						];
	if (status.saved === "unreadable") {
		const file = process
			.getBuiltinModule("node:path")
			.join(configDir(encodeURIComponent(appName)), `${FILE_NAME}.json`);
		lines.push(
			`The saved setting could not be read. Run "${cli} enable" or "${cli} disable" to rewrite ${file}.`,
		);
	}
	return lines.join("\n");
}
