import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { detectInstalledAgents, resolveAgentPath } from "./agents.ts";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("resolveAgentPath", () => {
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
});
