import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { McpLaunch } from "../src/index.ts";

const fixture = new URL("./fixtures/cli.ts", import.meta.url).pathname;
// Source mode runs the fixture on Bun, so its config names Bun's own executable.
const bunExecPath = spawnSync("bun", ["--print", "process.execPath"], {
	encoding: "utf8",
	timeout: 10_000,
}).stdout.trim();
let tempDir: string;
let compiled: string;

beforeAll(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "crust-mcp-"));
	compiled = join(tempDir, "demo");
	const build = spawnSync("bun", ["build", "--compile", fixture, "--outfile", compiled], {
		stdio: ["ignore", "ignore", "pipe"],
		timeout: 60_000,
	});
	expect(build.status).toBe(0);
}, 60_000);

afterAll(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

async function configOf(command: string, args: string[]) {
	const {
		stdout,
		stderr,
		status: exitCode,
	} = spawnSync(command, [...args, "mcp", "config"], { encoding: "utf8", timeout: 5_000 });
	expect(exitCode).toBe(0);
	// SAFETY: the command prints exactly the client config object; the test asserts its shape.
	const config = JSON.parse(stdout) as { mcpServers: { demo: McpLaunch & { type: string } } };
	return { launch: config.mcpServers.demo, stderr };
}

async function roundTrip(launch: McpLaunch) {
	const client = new Client({ name: "test", version: "0.0.0" });
	const transport = new StdioClientTransport({
		command: launch.command,
		args: [...launch.args],
		stderr: "pipe",
	});
	await client.connect(transport);
	try {
		expect(client.getServerVersion()).toMatchObject({ name: "demo", version: "0.1.0" });
		const { tools } = await client.listTools();
		// `mcp` and `mcp config` never become tools.
		expect(tools.map((tool) => tool.name)).toEqual(["greet"]);
		const result = await client.callTool({
			name: "greet",
			arguments: { name: "world", shout: true },
		});
		expect(result.structuredContent).toEqual({ greeting: "HELLO WORLD" });
	} finally {
		await client.close();
	}
}

describe("stdio serving through execute()", () => {
	it("source mode: config points at the runtime plus entry, and the server round-trips", async () => {
		const { launch, stderr } = await configOf("bun", [fixture]);
		expect(launch).toEqual({ type: "stdio", command: bunExecPath, args: [fixture, "mcp"] });
		expect(stderr).toBe(`Or run: claude mcp add demo -- ${bunExecPath} ${fixture} mcp\n`);
		await roundTrip(launch);
	});

	it("compiled mode: config points at the executable itself, and the server round-trips", async () => {
		const { launch } = await configOf(compiled, []);
		expect(launch).toEqual({ type: "stdio", command: compiled, args: ["mcp"] });
		await roundTrip(launch);
	});

	it("source mode: preserves a required Node preload when restarting from config", async () => {
		const entry = new URL("./fixtures/preloaded-cli.ts", import.meta.url).pathname;
		const preload = "data:text/javascript,process.env.CRUST_MCP_PRELOADED='1'";
		const { launch } = await configOf("node", ["--import", preload, entry]);
		expect(launch.args).toEqual(["--import", preload, entry, "mcp"]);
		await roundTrip(launch);
	});

	it("exits cleanly when the client hangs up", async () => {
		// An empty `input` closes stdin immediately, as a hanging-up client would.
		const child = spawnSync(compiled, ["mcp"], { input: "", encoding: "utf8", timeout: 5_000 });
		expect(child.status).toBe(0);
		expect(child.stdout).toBe("");
	});
});
