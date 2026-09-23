import process from "node:process";

if (process.env.CRUST_MCP_PRELOADED !== "1") {
	throw new Error("Required preload was not run");
}

// A restarted server must run the preload, not inherit its marker.
delete process.env.CRUST_MCP_PRELOADED;
await import("./cli.ts");
