import type * as mcp from "./index.ts";

// search_tools ranks with @crustjs/utils/search; the ranking is not part of this package's API.
// @ts-expect-error -- not exported from @crustjs/mcp
export type NoCreateSearchIndex = typeof mcp.createSearchIndex;
// @ts-expect-error -- not exported from @crustjs/mcp
export type NoSearchIndex = mcp.SearchIndex;
// @ts-expect-error -- not exported from @crustjs/mcp
export type NoSearchItem = mcp.SearchItem;
