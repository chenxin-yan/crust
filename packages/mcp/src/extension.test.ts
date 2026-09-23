import { describe, expect, it } from "bun:test";

import { type AnyCrust, Crust, defineCommand } from "@crustjs/core";

import {
	MCP_CLIENTS,
	mcpExtension,
	renderClaudeAddCommand,
	renderClientConfig,
	resolveLaunch,
} from "./extension.ts";
import { toolsFromSnapshot } from "./tools.ts";

const app = new Crust("demo", { version: "2.0.0" })
	.add(defineCommand("deploy", (c) => c.action(() => "deployed")))
	.add(defineCommand("wipe", (c) => c.action(() => "gone")))
	.extend(mcpExtension({ app: (): AnyCrust => app, exclude: [["wipe"]] }));

async function capture(argv: string[]) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const exitCode = await app.execute({
		argv,
		io: { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
	});
	return { exitCode, stdout, stderr };
}

describe("mcpExtension", () => {
	it("contributes mcp and mcp config, neither of which becomes a tool", async () => {
		const snapshot = await app.snapshot();
		expect(Object.keys(snapshot.subCommands.mcp?.subCommands ?? {})).toEqual(["config"]);
		expect(snapshot.subCommands.mcp?.hasAction).toBe(true);
		expect(toolsFromSnapshot(snapshot).map((tool) => tool.name)).toEqual(["deploy", "wipe"]);
	});

	it("prints parseable client JSON on stdout and Claude's one-liner on stderr", async () => {
		const claude = await capture(["mcp", "config"]);
		expect(claude.exitCode).toBe(0);
		expect(claude.stdout).toEqual([
			renderClientConfig("claude", "demo", resolveLaunch(process.execPath, process.argv[1], false)),
		]);
		expect(claude.stderr).toEqual([expect.stringMatching(/^Or run: claude mcp add demo -- /)]);

		const vscode = await capture(["mcp", "config", "--client", "vscode"]);
		expect(Object.keys(JSON.parse(vscode.stdout.join("")))).toEqual(["servers"]);
		expect(vscode.stderr).toEqual([]);
	});

	it("accepts a self-referential app callback without core changes", () => {
		const self: AnyCrust = app;
		expect(self).toBe(app);
	});
});

describe("resolveLaunch", () => {
	it("relaunches source entries through the runtime and compiled binaries directly", () => {
		expect(resolveLaunch("/usr/bin/bun", "/proj/src/cli.ts", false)).toEqual({
			command: "/usr/bin/bun",
			args: ["/proj/src/cli.ts", "mcp"],
		});
		expect(resolveLaunch("/opt/demo/demo", "/$bunfs/root/demo", true)).toEqual({
			command: "/opt/demo/demo",
			args: ["mcp"],
		});
		expect(resolveLaunch("/opt/demo/demo", undefined, false)).toEqual({
			command: "/opt/demo/demo",
			args: ["mcp"],
		});
	});
});

describe("renderClientConfig", () => {
	const launch = { command: "/usr/bin/bun", args: ["/proj/src/cli.ts", "mcp"] };

	it.each([...MCP_CLIENTS])("renders %s", (client) => {
		const parsed = JSON.parse(renderClientConfig(client, "demo", launch));
		const entry = { type: "stdio", command: "/usr/bin/bun", args: ["/proj/src/cli.ts", "mcp"] };
		expect(parsed).toEqual(
			client === "vscode" ? { servers: { demo: entry } } : { mcpServers: { demo: entry } },
		);
	});

	it("quotes shell-unsafe launch tokens in the claude one-liner", () => {
		expect(renderClaudeAddCommand("demo", launch)).toBe(
			"claude mcp add demo -- /usr/bin/bun /proj/src/cli.ts mcp",
		);
		expect(
			renderClaudeAddCommand("demo", {
				command: "/Applications/My App/bin",
				args: ["it's", "mcp"],
			}),
		).toBe(String.raw`claude mcp add demo -- '/Applications/My App/bin' 'it'\''s' mcp`);
	});
});
