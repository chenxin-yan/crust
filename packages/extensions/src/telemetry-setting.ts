// ────────────────────────────────────────────────────────────────────────────
// @crustjs/extensions — Telemetry's saved preference (loaded only when it is read or the command runs)
// ────────────────────────────────────────────────────────────────────────────

// Only `configDir` from the store: its object store cannot tell a missing file from one that lacks
// the key, and either must not be read as "nothing saved".
import { configDir } from "@crustjs/store";
import { isErrnoException } from "@crustjs/utils/error";

import type { SavedSetting, TelemetryStatus } from "./telemetry.ts";

/** The preference file, or why its directory could not be resolved. */
export function settingFile(appName: string): string | Error {
	try {
		// configDir rejects path separators; encodeURIComponent is injective, so distinct names never collide.
		const dir = configDir(encodeURIComponent(appName));
		return process.getBuiltinModule("node:path").join(dir, "telemetry.json");
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error));
	}
}

/**
 * One read decides: no file is nothing saved; anything but a JSON object whose only key is
 * `telemetry`, set to `"on"` or `"off"`, is `"unreadable"`. Never throws.
 */
export async function readSavedSetting(file: string | Error): Promise<SavedSetting | undefined> {
	if (file instanceof Error) return "unreadable";
	let text: string;
	try {
		text = await process.getBuiltinModule("node:fs/promises").readFile(file, "utf8");
	} catch (error) {
		return isErrnoException(error) && error.code === "ENOENT" ? undefined : "unreadable";
	}
	try {
		const document: unknown = JSON.parse(text);
		if (typeof document === "object" && document !== null && !Array.isArray(document)) {
			const keys = Object.keys(document);
			const value = (document as { telemetry?: unknown }).telemetry;
			if (keys.length === 1 && keys[0] === "telemetry" && (value === "on" || value === "off")) {
				return value;
			}
		}
	} catch {
		// Not JSON.
	}
	return "unreadable";
}

/**
 * Replaces the preference atomically: a private temporary file in the same directory, renamed over
 * the target, so a reader sees the old or the new choice. A new directory is private too; an
 * existing one keeps its mode. Throws a message for the user that nothing was saved.
 */
export async function writeSavedSetting(
	file: string | Error,
	setting: "on" | "off",
	env: string,
): Promise<void> {
	const instead = `Set ${env}=${setting === "on" ? "1" : "0"} to turn telemetry ${setting} without a saved preference.`;
	if (file instanceof Error) {
		throw new Error(
			`Could not save the telemetry preference: ${file.message.replace(/\.?$/, ".")}\n${instead}`,
			{ cause: file },
		);
	}
	const fs = process.getBuiltinModule("node:fs/promises");
	const { dirname } = process.getBuiltinModule("node:path");
	const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
	try {
		await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
		const handle = await fs.open(temp, "wx", 0o600);
		try {
			await handle.writeFile(`${JSON.stringify({ telemetry: setting })}\n`);
			await handle.sync();
		} finally {
			await handle.close();
		}
		await fs.rename(temp, file);
	} catch (error) {
		await fs.rm(temp, { force: true }).catch(() => {});
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`Could not save the telemetry preference to ${file}: ${reason}\n${instead}`, {
			cause: error,
		});
	}
}

/**
 * The text the command prints: what holds for this run, then what is saved. `change` is the choice
 * `enable` or `disable` just saved; `cli` is the command as configured (`acme telemetry`). A variable
 * is named, never its value.
 */
export function describeStatus(
	status: TelemetryStatus,
	change: "on" | "off" | undefined,
	cli: string,
	env: string,
	file: string | Error,
): string {
	const state = status.sending ? "on" : "off";
	const variable = status.decidedBy === "do-not-track" ? "DO_NOT_TRACK" : env;
	if (change !== undefined) {
		const saved = `Saved telemetry preference: ${change}.`;
		return status.sending === (change === "on")
			? saved
			: `${saved}\nTelemetry stays ${state} for this run because ${variable} is set.`;
	}
	const toggle = `Turn it ${status.sending ? "off" : "on"} with: ${cli} ${status.sending ? "disable" : "enable"}`;
	const repair =
		file instanceof Error
			? file.message.replace(/\.?$/, ".")
			: `Run "${cli} enable" or "${cli} disable" to rewrite ${file}.`;
	switch (status.decidedBy) {
		case "default":
			return `Telemetry is ${state} (the default). ${toggle}`;
		case "saved":
			return status.saved === "unreadable"
				? `Telemetry is off: the saved preference could not be read.\n${repair}`
				: `Telemetry is ${state} (saved preference). ${toggle}`;
		default: {
			const run =
				status.decidedBy === "env"
					? `Telemetry is ${state} for this run because ${variable} is set.`
					: `Telemetry is off because ${variable} is set.`;
			if (status.saved === undefined) return run;
			return status.saved === "unreadable"
				? `${run}\nThe saved preference could not be read. ${repair}`
				: `${run}\nThe saved preference is ${status.saved}.`;
		}
	}
}
