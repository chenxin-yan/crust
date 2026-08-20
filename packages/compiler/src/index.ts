import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { emitGo, runtimeModule } from "./emitter.js";
import { lower } from "./frontend.js";

export {
	CompilerError,
	DiagnosticCodes,
	TypeScriptCompileError,
	type CompilerDiagnostic,
	type DiagnosticCode,
} from "./diagnostics.js";

export interface CompileOptions {
	readonly outputPath?: string;
}

export async function compile(entryFile: string, options: CompileOptions = {}): Promise<string> {
	const ir = lower(entryFile);
	const workspace = await mkdtemp(join(tmpdir(), "crust-compiler-"));
	const goFile = join(workspace, "main.go");
	const defaultName = basename(entryFile, extname(entryFile));
	const outputPath = resolve(options.outputPath ?? join(workspace, defaultName));
	const runtimePath = fileURLToPath(new URL("../runtime", import.meta.url));

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
		await writeFile(
			join(workspace, "go.mod"),
			`module crust.generated\n\ngo 1.26\n\nrequire ${runtimeModule} v0.0.0\n\nreplace ${runtimeModule} => ${JSON.stringify(runtimePath)}\n`,
		);
		await promisify(execFile)("go", ["build", "-o", outputPath, "."], { cwd: workspace });
		built = true;
		return outputPath;
	} finally {
		if (!built || options.outputPath !== undefined) {
			await rm(workspace, { recursive: true, force: true });
		}
	}
}
