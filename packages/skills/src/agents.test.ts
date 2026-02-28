import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	AGENT_LABELS,
	ALL_AGENTS,
	detectInstalledAgents,
	resolveAgentPath,
} from "./agents.ts";

// ────────────────────────────────────────────────────────────────────────────
// resolveAgentPath
// ────────────────────────────────────────────────────────────────────────────

describe("resolveAgentPath", () => {
	describe("claude-code", () => {
		it("resolves global path to ~/.claude/skills/<name>/", () => {
			const result = resolveAgentPath("claude-code", "global", "my-cli");
			expect(result).toBe(join(homedir(), ".claude", "skills", "my-cli"));
		});

		it("resolves project path to <cwd>/.claude/skills/<name>/", () => {
			const result = resolveAgentPath("claude-code", "project", "my-cli");
			expect(result).toBe(join(process.cwd(), ".claude", "skills", "my-cli"));
		});
	});

	describe("opencode", () => {
		it("resolves global path to ~/.config/opencode/skills/<name>/", () => {
			const result = resolveAgentPath("opencode", "global", "my-cli");
			expect(result).toBe(
				join(homedir(), ".config", "opencode", "skills", "my-cli"),
			);
		});

		it("resolves project path to <cwd>/.opencode/skills/<name>/", () => {
			const result = resolveAgentPath("opencode", "project", "my-cli");
			expect(result).toBe(join(process.cwd(), ".opencode", "skills", "my-cli"));
		});
	});

	describe("edge cases", () => {
		it("handles skill names with hyphens", () => {
			const result = resolveAgentPath("claude-code", "global", "my-cli-tool");
			expect(result).toBe(join(homedir(), ".claude", "skills", "my-cli-tool"));
		});

		it("handles single-character skill names", () => {
			const result = resolveAgentPath("opencode", "global", "x");
			expect(result).toBe(
				join(homedir(), ".config", "opencode", "skills", "x"),
			);
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

describe("ALL_AGENTS", () => {
	it("contains claude-code and opencode", () => {
		expect(ALL_AGENTS).toContain("claude-code");
		expect(ALL_AGENTS).toContain("opencode");
	});
});

describe("AGENT_LABELS", () => {
	it("has a label for every agent in ALL_AGENTS", () => {
		for (const agent of ALL_AGENTS) {
			expect(AGENT_LABELS[agent]).toBeString();
			expect(AGENT_LABELS[agent].length).toBeGreaterThan(0);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// detectInstalledAgents
// ────────────────────────────────────────────────────────────────────────────

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

	it("returns empty array when no agent config dirs exist", async () => {
		const result = await detectInstalledAgents({ home: tmpDir });
		expect(result).toEqual([]);
	});

	it("detects claude-code in global scope when ~/.claude/ exists", async () => {
		await mkdir(join(tmpDir, ".claude"), { recursive: true });

		const result = await detectInstalledAgents({ home: tmpDir });
		expect(result).toContain("claude-code");
		expect(result).not.toContain("opencode");
	});

	it("detects opencode in global scope when ~/.config/opencode/ exists", async () => {
		await mkdir(join(tmpDir, ".config", "opencode"), { recursive: true });

		const result = await detectInstalledAgents({ home: tmpDir });
		expect(result).toContain("opencode");
		expect(result).not.toContain("claude-code");
	});

	it("detects both agents in global scope when both config dirs exist", async () => {
		await mkdir(join(tmpDir, ".claude"), { recursive: true });
		await mkdir(join(tmpDir, ".config", "opencode"), { recursive: true });

		const result = await detectInstalledAgents({ home: tmpDir });
		expect(result).toContain("claude-code");
		expect(result).toContain("opencode");
		expect(result).toHaveLength(2);
	});

	it("detects claude-code in project scope when <cwd>/.claude/ exists", async () => {
		await mkdir(join(tmpDir, ".claude"), { recursive: true });

		const result = await detectInstalledAgents({
			scope: "project",
			home: tmpDir,
			cwd: tmpDir,
		});
		expect(result).toContain("claude-code");
		expect(result).not.toContain("opencode");
	});

	it("detects opencode in project scope when <cwd>/.opencode/ exists", async () => {
		await mkdir(join(tmpDir, ".opencode"), { recursive: true });

		const result = await detectInstalledAgents({
			scope: "project",
			home: tmpDir,
			cwd: tmpDir,
		});
		expect(result).toContain("opencode");
		expect(result).not.toContain("claude-code");
	});

	it("falls back to global detection when project roots are missing", async () => {
		await mkdir(join(tmpDir, ".config", "opencode"), { recursive: true });

		const projectResult = await detectInstalledAgents({
			scope: "project",
			home: tmpDir,
			cwd: tmpDir,
		});
		expect(projectResult).toContain("opencode");

		await mkdir(join(tmpDir, ".opencode"), { recursive: true });
		const globalResult = await detectInstalledAgents({ home: tmpDir });
		expect(globalResult).toContain("opencode");
	});

	it("only returns known agent targets", async () => {
		// Create both to get a full result
		await mkdir(join(tmpDir, ".claude"), { recursive: true });
		await mkdir(join(tmpDir, ".config", "opencode"), { recursive: true });

		const result = await detectInstalledAgents({ home: tmpDir });
		for (const agent of result) {
			expect(ALL_AGENTS).toContain(agent);
		}
	});

	it("does not return duplicates", async () => {
		await mkdir(join(tmpDir, ".claude"), { recursive: true });
		await mkdir(join(tmpDir, ".config", "opencode"), { recursive: true });

		const result = await detectInstalledAgents({ home: tmpDir });
		const unique = new Set(result);
		expect(unique.size).toBe(result.length);
	});

	it("defaults to global scope and os.homedir() when no options provided", async () => {
		// Just verify it runs without error and returns an array
		const result = await detectInstalledAgents();
		expect(Array.isArray(result)).toBe(true);
	});

	it("accepts legacy string parameter as home override", async () => {
		await mkdir(join(tmpDir, ".claude"), { recursive: true });

		const result = await detectInstalledAgents(tmpDir);
		expect(result).toContain("claude-code");
	});
});
