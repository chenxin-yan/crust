import { spawn } from "node:child_process";
import { once } from "node:events";
import { lstatSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";
import { text } from "node:stream/consumers";

import { type BuildReport, defineExtensionId, type InvocationIO } from "@crustjs/core";
import { BUILD_OUT_DIR_ENV, type CommandSnapshot, SNAPSHOT_PATH_ENV } from "@crustjs/core/tooling";
import { yellow } from "@crustjs/style";
import { isErrnoException } from "@crustjs/utils/error";
import { isJsonObject, type JsonObject, type JsonValue } from "@crustjs/utils/json";
import { isWithin } from "@crustjs/utils/path";
import { killProcessTree } from "@crustjs/utils/process";

import { toBunEnvFileArgs } from "./bundle.ts";
import { type BuildRunner, resolveBunBuildRunner } from "./compilers.ts";

const SNAPSHOT_TIMEOUT_MS = 30_000;
const SNAPSHOT_FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;

function isBuildReport(value: JsonValue): value is JsonObject & BuildReport {
	return (
		isJsonObject(value) &&
		Array.isArray(value.extensions) &&
		value.extensions.every(
			(extension: JsonValue): extension is JsonObject & BuildReport["extensions"][number] =>
				isJsonObject(extension) &&
				typeof extension.id === "string" &&
				Array.isArray(extension.files) &&
				extension.files.every((file: JsonValue): file is string => typeof file === "string"),
		)
	);
}

/** Checks only the root `meta.name`, the one snapshot field crust reads. */
function isCommandSnapshot(value: JsonValue): value is JsonObject & CommandSnapshot {
	return (
		isJsonObject(value) &&
		value.meta !== undefined &&
		isJsonObject(value.meta) &&
		typeof value.meta.name === "string"
	);
}

/**
 * Prepare a CLI entry's Command Snapshot in the user's project context.
 *
 * The entry runs as a subprocess with `CRUST_INTERNAL_SNAPSHOT_PATH` pointing
 * to a temporary file. `.execute()` validates and writes the command graph and
 * adjacent Build Report, then exits before any following entrypoint code can run.
 *
 * Runs with the same bun as compilation (`resolveBunBuildRunner`, or the
 * pinned Bun `runner`): bun on PATH, or a compiled standalone crust executable
 * as `BUN_BE_BUN=1`, so arbitrary `.ts` entries run without a separate `bun`
 * install.
 *
 * After `timeoutMs`, the entry's POSIX process group or live Windows process
 * tree is killed and preparation fails, even if a descendant still holds stderr.
 * On POSIX, SIGINT, SIGTERM, SIGHUP, SIGQUIT or a synchronous exit of this
 * process also kills the entry's group, and whatever remains of the group is
 * killed once preparation settles.
 */
export async function buildEntrypoint(
	entryPath: string,
	outDir: string,
	envFiles: readonly string[],
	io: InvocationIO,
	cwd: string,
	runner: BuildRunner = resolveBunBuildRunner(),
	timeoutMs = SNAPSHOT_TIMEOUT_MS,
): Promise<{ snapshot: CommandSnapshot; build: BuildReport }> {
	const absoluteEntry = resolve(entryPath);
	const snapshotDir = await mkdtemp(join(tmpdir(), "crust-snapshot-"));
	const snapshotPath = join(snapshotDir, "command.json");
	const buildReportPath = join(snapshotDir, "build-report.json");

	try {
		const detached = process.platform !== "win32";
		const proc = spawn(runner.command, [...toBunEnvFileArgs(envFiles), absoluteEntry], {
			env: {
				...runner.env,
				[SNAPSHOT_PATH_ENV]: snapshotPath,
				[BUILD_OUT_DIR_ENV]: resolve(outDir),
			},
			cwd,
			stdio: ["ignore", "ignore", "pipe"],
			// Its own process group lets the deadline reach POSIX descendants.
			detached,
		});

		let stop!: (message: string) => void;
		const stopped = new Promise<never>((_, reject) => {
			stop = (message) => {
				let failure = new Error(message);
				try {
					killProcessTree(proc);
				} catch (cause) {
					failure = new Error(`${message}\n  Process-tree cleanup failed.`, { cause });
				}
				// A descendant holding the inherited stderr pipe must not keep "close" pending.
				proc.stderr.destroy();
				reject(failure);
			};
		});
		const timer = setTimeout(
			() =>
				stop(
					`Command Snapshot preparation timed out after ${timeoutMs / 1_000}s.\n  An Extension build hook may be hanging. Use --no-validate to skip entry preparation and build hooks.`,
				),
			timeoutMs,
		);
		// The detached group no longer receives terminal signals, so the entry stops with this
		// process. Like Core's SIGINT handling, re-raise only when no other listener owns the signal.
		// SIGKILL and native crashes cannot be observed and still orphan the entry.
		const onSignal = (signal: NodeJS.Signals): void => {
			removeLifetimeListeners();
			stop(`Command Snapshot preparation was interrupted by ${signal}.`);
			if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
		};
		// Also runs on synchronous exits (process.exit, uncaught errors), which skip the awaited cleanup.
		const killRemainingGroup = (): void => {
			try {
				killProcessTree(proc);
			} catch {
				// Best effort: the preparation outcome (or the exiting process) takes precedence.
			}
		};
		const removeLifetimeListeners = (): void => {
			for (const signal of SNAPSHOT_FORWARDED_SIGNALS) process.removeListener(signal, onSignal);
			process.removeListener("exit", killRemainingGroup);
		};
		if (detached) {
			for (const signal of SNAPSHOT_FORWARDED_SIGNALS) process.prependListener(signal, onSignal);
			process.on("exit", killRemainingGroup);
		}
		const [rawStderr, [exitCode]] = await Promise.race([
			Promise.all([text(proc.stderr), once(proc, "close")]),
			stopped,
		]).finally(() => {
			clearTimeout(timer);
			removeLifetimeListeners();
			// Workers the entry left behind in its detached group would escape terminal signals.
			if (detached) killRemainingGroup();
		});
		const stderr = rawStderr.trim();

		if (proc.signalCode !== null) {
			// Only the deadline and forwarded signals kill the entry, and both reject above:
			// this signal is external.
			throw new Error(
				`Command Snapshot preparation was killed by ${proc.signalCode}.${stderr ? `\n${stderr}` : ""}`,
			);
		}

		if (exitCode !== 0) {
			// stderr contains the raw error message from the snapshot subprocess
			throw new Error(stderr || "Command Snapshot preparation failed");
		}

		if (stderr) {
			// Style Warning: prefixed lines from snapshot preparation
			const styled = stderr
				.split("\n")
				.map((line) =>
					line.startsWith("Warning:")
						? `${yellow("Warning:")}${line.slice("Warning:".length)}`
						: line,
				)
				.join("\n");
			io.stderr(styled);
		}

		let serialized: string;
		try {
			serialized = await readFile(snapshotPath, "utf8");
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") {
				throw new Error(
					`Entry exited without producing a Command Snapshot.\n  Ensure ${absoluteEntry} calls await app.execute() and uses a compatible @crustjs/core version.`,
					{ cause: error },
				);
			}
			throw error;
		}
		let snapshot: CommandSnapshot;
		try {
			// Written by the application's Core, like the Build Report below.
			const parsed: JsonValue = JSON.parse(serialized);
			if (!isCommandSnapshot(parsed)) {
				throw new Error("Expected a root command with a string meta.name.");
			}
			snapshot = parsed;
		} catch (error) {
			throw new Error(
				`Entry produced an invalid Command Snapshot.\n  Ensure ${absoluteEntry} uses a compatible @crustjs/core version.`,
				{ cause: error },
			);
		}

		let serializedBuild: string;
		try {
			serializedBuild = await readFile(buildReportPath, "utf8");
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") {
				throw new Error(
					`Entry produced a Command Snapshot without a Build Report.\n  Ensure ${absoluteEntry} uses a compatible @crustjs/core version.`,
					{ cause: error },
				);
			}
			throw error;
		}
		try {
			// The subprocess uses the application's Core, which may have a different report contract.
			const build: JsonValue = JSON.parse(serializedBuild);
			if (!isBuildReport(build)) {
				throw new Error("Expected extensions with string ids and files arrays.");
			}
			for (const extension of build.extensions) {
				defineExtensionId(extension.id);
				for (const file of extension.files) {
					// Reports use Core's normalized POSIX-relative paths, not arbitrary entry side effects.
					const path = resolve(outDir, file);
					if (
						file === "." ||
						file.includes("\\") ||
						posix.normalize(file) !== file ||
						win32.isAbsolute(file) ||
						/^[A-Za-z]:/.test(file) ||
						!isWithin(resolve(outDir), path) ||
						!isWithin(realpathSync(outDir), realpathSync(path)) ||
						!lstatSync(path).isFile()
					) {
						throw new Error(
							`Reported artifact must be a normalized, contained regular file: ${file}`,
						);
					}
				}
			}
			return { snapshot, build };
		} catch (error) {
			throw new Error(
				`Entry produced an invalid Build Report.\n  Ensure ${absoluteEntry} uses a compatible @crustjs/core version; upgrade Core, @crustjs/crust, and build-hook Extensions together to the pure-return build API.`,
				{ cause: error },
			);
		}
	} finally {
		await rm(snapshotDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
}
