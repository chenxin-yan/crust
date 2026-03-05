import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	AGENT_LABELS,
	ALL_AGENTS,
	detectInstalledAgents,
	getAdditionalAgents,
	getUniversalAgents,
	isUniversalAgent,
	resolveAgentPath,
} from "./agents.ts";

describe("resolveAgentPath", () => {
	it("resolves claude-code project path", () => {
		const result = resolveAgentPath("claude-code", "project", "my-cli");
		expect(result).toBe(join(process.cwd(), ".claude", "skills", "my-cli"));
	});

	it("resolves opencode project path to canonical universal dir", () => {
		const result = resolveAgentPath("opencode", "project", "my-cli");
		expect(result).toBe(join(process.cwd(), ".agents", "skills", "my-cli"));
	});

	it("resolves claude-code global path", () => {
		const result = resolveAgentPath("claude-code", "global", "my-cli");
		expect(result).toBe(join(homedir(), ".claude", "skills", "my-cli"));
	});

	it("resolves opencode global path", () => {
		const result = resolveAgentPath("opencode", "global", "my-cli");
		expect(result).toBe(
			join(homedir(), ".config", "agents", "skills", "my-cli"),
		);
	});
});

describe("agent registry", () => {
	it("contains expected baseline agents", () => {
		expect(ALL_AGENTS).toContain("claude-code");
		expect(ALL_AGENTS).toContain("opencode");
		expect(ALL_AGENTS).toContain("codex");
	});

	it("has a label for every agent", () => {
		for (const agent of ALL_AGENTS) {
			expect(AGENT_LABELS[agent]).toBeString();
			expect(AGENT_LABELS[agent].length).toBeGreaterThan(0);
		}
	});

	it("splits universal and additional agents", () => {
		const universal = getUniversalAgents();
		const additional = getAdditionalAgents();

		expect(universal).toContain("opencode");
		expect(additional).toContain("claude-code");
		expect(isUniversalAgent("opencode")).toBe(true);
		expect(isUniversalAgent("claude-code")).toBe(false);

		const merged = new Set([...universal, ...additional]);
		expect(merged.size).toBe(ALL_AGENTS.length);
	});
});

describe("detectInstalledAgents", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = join(
			tmpdir(),
			`crust-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(tmpDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("returns empty array when no config dirs exist", async () => {
		const result = await detectInstalledAgents({ home: tmpDir });
		expect(result).toEqual([]);
	});

	it("detects claude-code from ~/.claude", async () => {
		await mkdir(join(tmpDir, ".claude"), { recursive: true });
		const result = await detectInstalledAgents({ home: tmpDir });
		expect(result).toContain("claude-code");
	});

	it("detects opencode from ~/.config/opencode", async () => {
		await mkdir(join(tmpDir, ".config", "opencode"), { recursive: true });
		const result = await detectInstalledAgents({ home: tmpDir });
		expect(result).toContain("opencode");
	});

	it("detects opencode in project scope from <cwd>/.opencode", async () => {
		await mkdir(join(tmpDir, ".opencode"), { recursive: true });
		const result = await detectInstalledAgents({
			scope: "project",
			home: tmpDir,
			cwd: tmpDir,
		});
		expect(result).toContain("opencode");
	});

	it("does not return duplicates", async () => {
		await mkdir(join(tmpDir, ".claude"), { recursive: true });
		await mkdir(join(tmpDir, ".config", "opencode"), { recursive: true });
		const result = await detectInstalledAgents({ home: tmpDir });
		expect(new Set(result).size).toBe(result.length);
	});

	it("accepts legacy string parameter as home override", async () => {
		await mkdir(join(tmpDir, ".claude"), { recursive: true });
		const result = await detectInstalledAgents(tmpDir);
		expect(result).toContain("claude-code");
	});

	it("uses home override even when XDG_CONFIG_HOME is set", async () => {
		const previousXdg = process.env.XDG_CONFIG_HOME;
		const xdgConfigHome = join(tmpDir, "xdg-config");
		await mkdir(join(xdgConfigHome, "opencode"), { recursive: true });
		process.env.XDG_CONFIG_HOME = xdgConfigHome;

		try {
			const result = await detectInstalledAgents({ home: tmpDir });
			expect(result).not.toContain("opencode");
		} finally {
			if (previousXdg === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = previousXdg;
			}
		}
	});
});
