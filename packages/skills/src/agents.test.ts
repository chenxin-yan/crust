import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveAgentPath } from "./agents.ts";

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
