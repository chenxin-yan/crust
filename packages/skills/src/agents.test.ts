import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { accessSync, chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { detectInstalledAgents, resolveAgentPath } from "./agents.ts";

describe("resolveAgentPath", () => {
	it("resolves claude-code project path", () => {
		const result = resolveAgentPath("claude-code", "project", "my-cli");
		expect(result).toBe(join(process.cwd(), ".claude", "skills", "my-cli"));
	});

	it("resolves claude-code global path", () => {
		const result = resolveAgentPath("claude-code", "global", "my-cli");
		expect(result).toBe(join(homedir(), ".claude", "skills", "my-cli"));
	});

	it("resolves Mistral Vibe's global path from VIBE_HOME, falling back to ~/.vibe", () => {
		const original = process.env.VIBE_HOME;
		try {
			process.env.VIBE_HOME = join(homedir(), "custom-vibe");
			expect(resolveAgentPath("mistral-vibe", "global", "my-cli")).toBe(
				join(homedir(), "custom-vibe", "skills", "my-cli"),
			);
			delete process.env.VIBE_HOME;
			expect(resolveAgentPath("mistral-vibe", "global", "my-cli")).toBe(
				join(homedir(), ".vibe", "skills", "my-cli"),
			);
		} finally {
			if (original === undefined) {
				delete process.env.VIBE_HOME;
			} else {
				process.env.VIBE_HOME = original;
			}
		}
	});
});

describe("detectInstalledAgents", () => {
	let tmpDir: string;
	let originalPath: string | undefined;
	let originalPathExt: string | undefined;

	beforeEach(() => {
		tmpDir = join(
			tmpdir(),
			`crust-agent-detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tmpDir, { recursive: true });
		originalPath = process.env.PATH;
		originalPathExt = process.env.PATHEXT;
	});

	afterEach(() => {
		if (originalPath !== undefined) {
			process.env.PATH = originalPath;
		}
		if (originalPathExt === undefined) {
			delete process.env.PATHEXT;
		} else {
			process.env.PATHEXT = originalPathExt;
		}
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("detects additional but not universal commands on PATH", async () => {
		for (const name of ["claude", "opencode"]) {
			const fakeBin = join(tmpDir, name);
			writeFileSync(fakeBin, "#!/bin/sh\necho fake");
			chmodSync(fakeBin, 0o755);
		}
		process.env.PATH = `${tmpDir}${delimiter}${process.env.PATH}`;

		const result = await detectInstalledAgents();
		expect(result).toContain("claude-code");
		expect(result).not.toContain("opencode");
	});

	it("does not detect a command that is not on PATH", async () => {
		// Use an empty PATH so nothing is found
		process.env.PATH = tmpDir; // empty dir, no executables

		const result = await detectInstalledAgents();
		expect(result).toEqual([]);
	});

	it("does not detect a non-executable file on PATH", async () => {
		// Create a non-executable file
		const fakeBin = join(tmpDir, "claude");
		writeFileSync(fakeBin, "#!/bin/sh\necho fake");
		chmodSync(fakeBin, 0o644); // readable but not executable

		process.env.PATH = tmpDir; // only our temp dir, so no real `claude` can be found

		const result = await detectInstalledAgents();
		expect(result).not.toContain("claude-code");
	});

	it("does not detect a directory named like a command", async () => {
		// The platform-specific name (`claude` vs `claude.CMD`) ensures the PATH
		// lookup sees this entry and still rejects it because it is a directory.
		const dirName = process.platform === "win32" ? "claude.CMD" : "claude";
		const fakeDir = join(tmpDir, dirName);
		mkdirSync(fakeDir, { recursive: true });
		if (process.platform !== "win32") {
			chmodSync(fakeDir, 0o755);
		}
		if (process.platform === "win32") {
			process.env.PATHEXT = ".CMD";
		}

		process.env.PATH = tmpDir;

		const result = await detectInstalledAgents();
		expect(result).not.toContain("claude-code");
	});

	it("never spawns external processes during detection", async () => {
		// Create executables for multiple agents
		for (const name of ["claude", "windsurf", "goose"]) {
			const fakeBin = join(tmpDir, name);
			// Script that would create a marker file if actually executed
			writeFileSync(fakeBin, `#!/bin/sh\ntouch "${join(tmpDir, `${name}-was-executed`)}"`);
			chmodSync(fakeBin, 0o755);
		}

		process.env.PATH = `${tmpDir}${delimiter}${process.env.PATH}`;

		await detectInstalledAgents();

		// Verify none of the scripts were actually executed
		for (const name of ["claude", "windsurf", "goose"]) {
			const markerExists = (() => {
				try {
					accessSync(join(tmpDir, `${name}-was-executed`));
					return true;
				} catch {
					return false;
				}
			})();
			expect(markerExists).toBe(false);
		}
	});
});
