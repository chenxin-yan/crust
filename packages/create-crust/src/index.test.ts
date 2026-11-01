import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { app } from "./index.ts";

let tempRoot: string;

beforeEach(() => {
	tempRoot = mkdtempSync(join(tmpdir(), "create-crust-app-"));
});

afterEach(() => {
	rmSync(tempRoot, { recursive: true, force: true });
	vi.restoreAllMocks();
	process.exitCode = undefined;
});

describe("create-crust app (in-process)", () => {
	it("aborts without writing when the destination exists and --no-overwrite is passed", async () => {
		const projectDir = join(tempRoot, "existing-cli");
		mkdirSync(projectDir);
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		const exitCode = await app.execute({ argv: [projectDir, "--no-overwrite"] });

		expect(exitCode).toBe(0);
		expect(log).toHaveBeenCalledWith("Aborted.");
		expect(readdirSync(projectDir)).toEqual([]);
	});

	it("rejects an unsafe project name before writing anything", async () => {
		const projectDir = join(tempRoot, "Bad Name");
		let stderr = "";

		const exitCode = await app.execute({
			argv: [projectDir],
			io: { stderr: (text) => (stderr += text) },
		});

		expect(exitCode).toBe(1);
		expect(stderr).toContain('Project name "Bad Name" is not safe for the generated project.');
		expect(existsSync(projectDir)).toBe(false);
	});
});
