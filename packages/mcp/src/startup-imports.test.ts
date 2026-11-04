import { expect, it, vi } from "vite-plus/test";

// The SDK takes ~100 ms to load; a CLI using mcpExtension() should pay that only when `mcp` runs.
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
	throw new Error("the MCP SDK was loaded on import");
});
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
	throw new Error("the MCP SDK was loaded on import");
});
vi.mock("@modelcontextprotocol/sdk/types.js", () => {
	throw new Error("the MCP SDK was loaded on import");
});

it("does not load the MCP SDK when imported", async () => {
	await expect(import("./index.ts")).resolves.toHaveProperty("mcpExtension");
});
