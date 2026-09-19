import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compile, TypeScriptCompileError } from "../src/index.js";

describe("compile", () => {
	it("reports missing Go from an outside cwd", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "crust-compiler-no-go-"));
		try {
			await writeFile(join(workspace, "entry.ts"), 'console.log("hello");');
			const entrypoint = new URL("../src/index.ts", import.meta.url).href;
			const child = Bun.spawnSync(
				[
					process.execPath,
					"--eval",
					`import { compile } from ${JSON.stringify(entrypoint)};
					try { await compile("entry.ts"); }
					catch (error) {
						if (error.cause?.code !== "ENOENT") throw error;
						console.error(error.message); process.exitCode = 1;
					}`,
				],
				{ cwd: workspace, env: { ...process.env, PATH: workspace } },
			);
			expect(child.exitCode).toBe(1);
			expect(child.stdout.toString()).toBe("");
			expect(child.stderr.toString()).toBe(
				"Go toolchain not found. Install Go and ensure the go executable is on PATH.\n",
			);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	it("preserves unexpected filesystem errors", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "crust-compiler-output-"));
		try {
			const parentFile = join(workspace, "not-a-directory");
			await writeFile(parentFile, "");
			const fixture = join(import.meta.dir, "fixtures", "hello.ts");
			await expect(
				compile(fixture, { outputPath: join(parentFile, "binary") }),
			).rejects.toMatchObject({
				code: "ENOTDIR",
			});
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === "win32")("preserves Go build failures", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "crust-compiler-failed-go-"));
		try {
			await writeFile(join(workspace, "entry.ts"), 'console.log("hello");');
			await writeFile(join(workspace, "go"), '#!/bin/sh\nprintf "backend failure" >&2\nexit 7\n', {
				mode: 0o700,
			});
			const entrypoint = new URL("../src/index.ts", import.meta.url).href;
			const child = Bun.spawnSync(
				[
					process.execPath,
					"--eval",
					`import assert from "node:assert/strict";
					import { compile } from ${JSON.stringify(entrypoint)};
					await assert.rejects(compile("entry.ts"), { code: 7, stderr: "backend failure" });`,
				],
				{ cwd: workspace, env: { ...process.env, PATH: workspace } },
			);
			expect(child.stderr.toString()).toBe("");
			expect(child.exitCode).toBe(0);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	for (const expression of ["Bun.version", "process.version", "document.title"]) {
		it(`does not discover host globals: ${expression}`, async () => {
			const workspace = await mkdtemp(join(tmpdir(), "crust-compiler-checker-"));
			try {
				const fixture = join(workspace, "entry.ts");
				await writeFile(fixture, `console.log(${expression});`);
				await expect(compile(fixture)).rejects.toBeInstanceOf(TypeScriptCompileError);
			} finally {
				await rm(workspace, { recursive: true, force: true });
			}
		});
	}
});
