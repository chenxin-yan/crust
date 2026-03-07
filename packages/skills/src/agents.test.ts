import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	accessSync,
	chmodSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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

describe("PATH-based detection (default commandChecker)", () => {
	let tmpDir: string;
	let originalPath: string | undefined;

	beforeEach(() => {
		tmpDir = join(
			tmpdir(),
			`crust-agent-detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tmpDir, { recursive: true });
		originalPath = process.env.PATH;
	});

	afterEach(() => {
		if (originalPath !== undefined) {
			process.env.PATH = originalPath;
		}
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("detects a command present on PATH as executable", async () => {
		// Create a fake executable in the temp dir
		const fakeBin = join(tmpDir, "claude");
		writeFileSync(fakeBin, "#!/bin/sh\necho fake");
		chmodSync(fakeBin, 0o755);

		// Prepend temp dir to PATH
		process.env.PATH = `${tmpDir}${delimiter}${process.env.PATH}`;

		const result = await detectInstalledAgents();
		expect(result).toContain("claude-code");
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

	it("never spawns external processes during detection", async () => {
		// Create executables for multiple agents
		for (const name of ["claude", "windsurf", "goose"]) {
			const fakeBin = join(tmpDir, name);
			// Script that would create a marker file if actually executed
			writeFileSync(
				fakeBin,
				`#!/bin/sh\ntouch "${join(tmpDir, `${name}-was-executed`)}"`,
			);
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
