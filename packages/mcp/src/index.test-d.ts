import type * as mcp from "./index.ts";

// search_tools ranks with an internal index; it is not part of the package API.
// @ts-expect-error -- not exported from @crustjs/mcp
export type NoCreateToolIndex = typeof mcp.createToolIndex;
// @ts-expect-error -- not exported from @crustjs/mcp
export type NoToolIndex = mcp.ToolIndex;
