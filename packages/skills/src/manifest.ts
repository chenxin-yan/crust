// ────────────────────────────────────────────────────────────────────────────
// Command-tree introspection — builds canonical manifest from defineCommand
// ────────────────────────────────────────────────────────────────────────────

import type { AnyCommand } from "@crustjs/core";
import type { ManifestNode } from "./types.ts";

/**
 * Builds a canonical manifest tree from a root command definition.
 *
 * Walks the command tree (including nested `subCommands`) and normalizes
 * each node into a deterministic {@link ManifestNode} shape suitable for
 * rendering into markdown documentation.
 *
 * @param command - The root command to introspect
 * @returns The manifest tree rooted at the given command
 *
 * @example
 * ```ts
 * import { defineCommand } from "@crustjs/core";
 * import { buildManifest } from "@crustjs/skills";
 *
 * const root = defineCommand({
 *   meta: { name: "my-cli", description: "My CLI tool" },
 *   subCommands: { serve, build },
 * });
 *
 * const manifest = buildManifest(root);
 * // manifest.children contains normalized nodes for "serve" and "build"
 * ```
 */
export function buildManifest(_command: AnyCommand): ManifestNode {
	// TODO: Implement in task 2 — command-tree introspection
	throw new Error("buildManifest is not yet implemented");
}
