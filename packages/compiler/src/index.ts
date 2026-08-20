import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

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

	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(goFile, emitGo(ir));
	await build(goFile, outputPath);
	return outputPath;
}

async function build(goFile: string, outputPath: string): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		const child = spawn("go", ["build", "-o", outputPath, goFile], {
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolvePromise();
			else reject(new Error(`go build failed with exit code ${code}:\n${stderr}`));
		});
	});
}
