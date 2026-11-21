import { Crust, defineCommand } from "@crustjs/core";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, vi } from "vite-plus/test";

import type { McpToolsOptions } from "./tools.ts";

const state = vi.hoisted(() => ({ allowSdk: false, rankingLoaded: false }));

// The SDK takes ~100 ms to load; a CLI using mcpExtension() should pay that only when `mcp` runs.
vi.mock("@modelcontextprotocol/server", async (importOriginal) => {
	if (!state.allowSdk) throw new Error("the MCP SDK was loaded on import");
	return importOriginal();
});
vi.mock("@modelcontextprotocol/server/stdio", () => {
	throw new Error("the MCP SDK was loaded on import");
});
// The ranking serves only search_tools; serving tools must not load it.
vi.mock("@crustjs/utils/search", async (importOriginal) => {
	state.rankingLoaded = true;
	return importOriginal();
});

it("loads neither the MCP SDK nor the search ranking when imported", async () => {
	await expect(import("./index.ts")).resolves.toHaveProperty("mcpExtension");
	expect(state.rankingLoaded).toBe(false);
});

async function connect(options: McpToolsOptions) {
	state.allowSdk = true;
	const { createMcpServer } = await import("./index.ts");
	const app = new Crust("acme").add(
		defineCommand("deploy", { description: "Deploy the app" }, (cmd) => cmd.action(() => "ok")),
	);
	const server = await createMcpServer(app, options);
	const client = new Client({ name: "test-client", version: "0.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return client;
}

it("does not load the search ranking to list and call tools", async () => {
	const direct = await connect({});
	expect((await direct.listTools()).tools.map((tool) => tool.name)).toEqual(["deploy"]);
	expect((await direct.callTool({ name: "deploy" })).isError).toBeUndefined();

	const progressive = await connect({ discovery: "progressive" });
	expect((await progressive.listTools()).tools).toHaveLength(3);
	expect(
		(await progressive.callTool({ name: "call_tool", arguments: { name: "deploy" } })).isError,
	).toBeUndefined();
	expect(state.rankingLoaded).toBe(false);

	const found = await progressive.callTool({
		name: "search_tools",
		arguments: { query: "deploy" },
	});
	expect(found.structuredContent).toEqual({
		result: [{ name: "deploy", description: "Deploy the app" }],
	});
	expect(state.rankingLoaded).toBe(true);
});
