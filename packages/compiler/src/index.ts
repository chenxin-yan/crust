import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { emitGo } from "./emitter.js";
import { lower } from "./frontend.js";

export { TypeScriptCompileError } from "./frontend.js";

export interface CompileOptions {
	readonly outputPath?: string;
}

export async function compile(entryFile: string, options: CompileOptions = {}): Promise<string> {
	const ir = lower(entryFile);
	const workspace = await mkdtemp(join(tmpdir(), "crust-compiler-"));
	const goFile = join(workspace, "main.go");
	const defaultName = basename(entryFile, extname(entryFile));
	const outputPath = resolve(options.outputPath ?? join(workspace, defaultName));

	let built = false;
	try {
		try {
			if ((await stat(outputPath)).isDirectory()) {
				throw new Error(`Compiler output path must not be a directory: ${outputPath}`);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(goFile, emitGo(ir));
		await promisify(execFile)("go", ["build", "-o", outputPath, goFile]);
		built = true;
		return outputPath;
	} finally {
		if (!built || options.outputPath !== undefined) {
			await rm(workspace, { recursive: true, force: true });
		}
	}
}
