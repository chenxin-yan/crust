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
		// As a client config's `env` would set it.
		env: { ...process.env, DEMO_TOKEN: "s3cret" },
		stderr: "pipe",
	});
	await client.connect(transport);
	try {
		expect(client.getServerVersion()).toMatchObject({ name: "demo", version: "0.1.0" });
		const { tools } = await client.listTools();
		// `mcp` and `mcp config` never become tools, and input()'s `--input` is no tool input.
		expect(tools.map((tool) => tool.name)).toEqual(["greet", "whoami", "slurp"]);
		expect(Object.keys(tools[0]!.inputSchema.properties ?? {})).toEqual(["name", "shout", "raw"]);
		// The env-backed flag is optional: the server's environment supplies it.
		expect(tools[1]!.inputSchema.required).toBeUndefined();
		const greet = { name: "greet", arguments: { name: "world", shout: true } };
		expect((await client.callTool(greet)).structuredContent).toEqual({
			greeting: "HELLO WORLD",
		});
		expect((await client.callTool({ name: "whoami" })).structuredContent).toEqual({
			token: "s3cret",
		});
		// Neither path reads the protocol's stdin, so the session keeps serving.
		const stdinRead = await client.callTool(
			{ name: "greet", arguments: { name: "world", input: "-" } },
			undefined,
			{ timeout: 2_000 },
		);
		expect(stdinRead).toMatchObject({
			isError: true,
			content: [{ type: "text", text: 'PARSE: Unknown flag "--input"' }],
		});
		const slurp = await client.callTool({ name: "slurp" }, undefined, { timeout: 2_000 });
		expect(slurp).toMatchObject({
			isError: true,
			content: [{ type: "text", text: "Error: stdin is in use by another reader" }],
		});
		expect((await client.callTool(greet, undefined, { timeout: 2_000 })).structuredContent).toEqual(
			{ greeting: "HELLO WORLD" },
		);
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

	it("exits cleanly when the client hangs up", async () => {
		// An empty `input` closes stdin immediately, as a hanging-up client would.
		const child = spawnSync(compiled, ["mcp"], { input: "", encoding: "utf8", timeout: 5_000 });
		expect(child.status).toBe(0);
		expect(child.stdout).toBe("");
	});
});
