import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
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
		expect(result).toBe(join(homedir(), ".agents", "skills", "my-cli"));
	});
});

describe("agent registry", () => {
	it("contains expected baseline agents", () => {
		expect(ALL_AGENTS).toContain("claude-code");
		expect(ALL_AGENTS).toContain("opencode");
		expect(ALL_AGENTS).toContain("codex");
		expect(ALL_AGENTS).toContain("windsurf");
		expect(ALL_AGENTS).toContain("openclaw");
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
		expect(universal).toContain("codex");
		expect(additional).toContain("claude-code");
		expect(additional).toContain("windsurf");
		expect(isUniversalAgent("opencode")).toBe(true);
		expect(isUniversalAgent("claude-code")).toBe(false);

		const merged = new Set([...universal, ...additional]);
		expect(merged.size).toBe(ALL_AGENTS.length);
	});
});

describe("detectInstalledAgents", () => {
	it("returns empty array when no commands are available", async () => {
		const result = await detectInstalledAgents({
			commandChecker: async () => false,
		});
		expect(result).toEqual([]);
	});

	it("detects additional agents by command availability", async () => {
		const result = await detectInstalledAgents({
			commandChecker: async (command) =>
				command === "claude" || command === "windsurf",
		});
		expect(result).toContain("claude-code");
		expect(result).toContain("windsurf");
	});

	it("does not include universal agents in detection output", async () => {
		const result = await detectInstalledAgents({
			commandChecker: async (command) => command === "opencode",
		});
		expect(result).not.toContain("opencode");
	});

	it("accepts legacy string parameter", async () => {
		const result = await detectInstalledAgents("/tmp");
		expect(Array.isArray(result)).toBe(true);
	});
});
