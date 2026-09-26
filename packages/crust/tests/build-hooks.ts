import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AnyCrust, BuildReport } from "@crustjs/core";
import { BUILD_OUT_DIR_ENV, SNAPSHOT_PATH_ENV } from "@crustjs/core/tooling";

/**
 * Run an application's Extension build hooks in-process through Core's build
 * boundary, as `crust build` does in its entry subprocess. Returns the written
 * files (text, in Build Report order) or the failure message Core prints.
 */
export async function runBuildHooks(
	app: AnyCrust,
): Promise<{ readonly files: Map<string, string>; readonly error?: string }> {
	const dir = await mkdtemp(join(tmpdir(), "crust-build-hooks-"));
	const outDir = join(dir, "out");
	// oxlint-disable-next-line typescript/unbound-method -- restored unchanged after the stub.
	const originalExit = process.exit;
	const originalConsoleError = console.error;
	const originalEnv = [SNAPSHOT_PATH_ENV, BUILD_OUT_DIR_ENV].map(
		(key) => [key, process.env[key]] as const,
	);
	const exited = new Error("process.exit");
	let error: string | undefined;
	process.env[SNAPSHOT_PATH_ENV] = join(dir, "snapshot.json");
	process.env[BUILD_OUT_DIR_ENV] = outDir;
	// The build boundary ends the process; stop it at the exit call instead.
	process.exit = () => {
		throw exited;
	};
	console.error = (message: string) => {
		error = message;
	};
	try {
		try {
			await app.execute({ argv: [] });
		} catch (thrown) {
			if (thrown !== exited) throw thrown;
		}
		const files = new Map<string, string>();
		if (error !== undefined) return { files, error };
		const report: BuildReport = JSON.parse(await readFile(join(dir, "build-report.json"), "utf8"));
		for (const path of report.extensions.flatMap((extension) => extension.files)) {
			files.set(path, await readFile(join(outDir, path), "utf8"));
		}
		return { files };
	} finally {
		process.exit = originalExit;
		console.error = originalConsoleError;
		for (const [key, value] of originalEnv) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(dir, { recursive: true, force: true });
	}
}
