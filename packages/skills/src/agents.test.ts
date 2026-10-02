import { accessSync, chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { detectInstalledAgents, resolveAgentPath } from "./agents.ts";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("resolveAgentPath", () => {
	it("resolves claude-code project path", () => {
		const result = resolveAgentPath("claude-code", "project", "my-cli");
		expect(result).toBe(join(process.cwd(), ".claude", "skills", "my-cli"));
	});

	it("resolves claude-code global path", () => {
		vi.stubEnv("CLAUDE_CONFIG_DIR", undefined);
		expect(resolveAgentPath("claude-code", "global", "my-cli")).toBe(
			join(homedir(), ".claude", "skills", "my-cli"),
		);
		vi.stubEnv("CLAUDE_CONFIG_DIR", join(homedir(), "custom-claude"));
		expect(resolveAgentPath("claude-code", "global", "my-cli")).toBe(
			join(homedir(), "custom-claude", "skills", "my-cli"),
		);
	});

	it("resolves Mistral Vibe's global path from VIBE_HOME, falling back to ~/.vibe", () => {
		vi.stubEnv("VIBE_HOME", join(homedir(), "custom-vibe"));
		expect(resolveAgentPath("mistral-vibe", "global", "my-cli")).toBe(
			join(homedir(), "custom-vibe", "skills", "my-cli"),
		);
		vi.stubEnv("VIBE_HOME", undefined);
		expect(resolveAgentPath("mistral-vibe", "global", "my-cli")).toBe(
			join(homedir(), ".vibe", "skills", "my-cli"),
		);
	});
});

describe("detectInstalledAgents", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(
			tmpdir(),
			`crust-agent-detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("detects additional but not universal commands on PATH", async () => {
		for (const name of ["claude", "opencode"]) {
			const fakeBin = join(tmpDir, name);
			writeFileSync(fakeBin, "#!/bin/sh\necho fake");
			chmodSync(fakeBin, 0o755);
		}
		vi.stubEnv("PATH", `${tmpDir}${delimiter}${process.env.PATH}`);

		const result = await detectInstalledAgents();
		expect(result).toContain("claude-code");
		expect(result).not.toContain("opencode");
	});

	it("does not detect a command that is not on PATH", async () => {
		// Use an empty PATH so nothing is found
		vi.stubEnv("PATH", tmpDir); // empty dir, no executables

		const result = await detectInstalledAgents();
		expect(result).toEqual([]);
	});

	it("does not detect a non-executable file on PATH", async () => {
		// Create a non-executable file
		const fakeBin = join(tmpDir, "claude");
		writeFileSync(fakeBin, "#!/bin/sh\necho fake");
		chmodSync(fakeBin, 0o644); // readable but not executable

		vi.stubEnv("PATH", tmpDir); // only our temp dir, so no real `claude` can be found

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
			vi.stubEnv("PATHEXT", ".CMD");
		}

		vi.stubEnv("PATH", tmpDir);

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

		vi.stubEnv("PATH", `${tmpDir}${delimiter}${process.env.PATH}`);

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
