import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { withCwd } from "../tests/fixtures.ts";
import {
	agentDetectionFolder,
	detectInstalledAgents,
	getScopeAgents,
	getUniversalAgents,
	resolveAgentPath,
} from "./agents.ts";

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

	it("rejects global scope for an agent without a global skills directory", () => {
		expect(resolveAgentPath("eve", "project", "my-cli")).toBe(
			join(process.cwd(), "agent", "skills", "my-cli"),
		);
		expect(() => resolveAgentPath("eve", "global", "my-cli")).toThrow(
			'Agent "eve" (Eve) has no global skills directory; use project scope.',
		);
		expect(getScopeAgents("project")).toContain("eve");
		expect(getScopeAgents("global")).not.toContain("eve");
	});
});

describe("getUniversalAgents", () => {
	it("lists only agents using .agents/skills at both scopes", () => {
		const universal = getUniversalAgents();
		expect(universal).toContain("codex");
		// `.agents/skills` in the project, but its own global directory.
		expect(universal).not.toContain("cursor");
	});
});

describe("detectInstalledAgents", () => {
	let tmpDir: string;
	let home: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "crust-agent-detect-test-"));
		home = join(tmpDir, "home");
		mkdirSync(home);
		vi.stubEnv("HOME", home);
		vi.stubEnv("USERPROFILE", home);
		vi.stubEnv("CLAUDE_CONFIG_DIR", undefined);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("detects an additional agent by the folder containing its global skills directory", async () => {
		mkdirSync(join(home, ".claude"));
		mkdirSync(join(home, ".config", "opencode"), { recursive: true });
		// Universal agents are offered as one group, never detected.
		mkdirSync(join(home, ".agents", "skills"), { recursive: true });

		expect(await detectInstalledAgents()).toEqual(["claude-code", "opencode"]);
	});

	it("detects Claude Code by CLAUDE_CONFIG_DIR when it is set", async () => {
		mkdirSync(join(home, ".claude"));
		const configDir = join(tmpDir, "claude-config");
		mkdirSync(configDir);
		vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
		expect(await detectInstalledAgents()).toEqual(["claude-code"]);

		rmSync(configDir, { recursive: true });
		expect(await detectInstalledAgents()).toEqual([]);
	});

	it("does not consult project folders", async () => {
		const project = join(tmpDir, "project");
		for (const dir of [".claude", ".cursor", "skills", ".agents"]) {
			mkdirSync(join(project, dir), { recursive: true });
		}

		expect(await withCwd(project, () => detectInstalledAgents())).toEqual([]);
	});

	it("does not count the home directory or the shared ~/.agents as an agent's folder", () => {
		expect(agentDetectionFolder(join(home, ".claude", "skills"), home)).toBe(join(home, ".claude"));
		expect(agentDetectionFolder(join(home, "skills"), home)).toBeUndefined();
		expect(agentDetectionFolder(join(home, ".agents", "skills"), home)).toBeUndefined();
	});
});
