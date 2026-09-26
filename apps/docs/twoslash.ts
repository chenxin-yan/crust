import { transformerTwoslash } from "fumadocs-twoslash";
import { createFileSystemTypesCache } from "fumadocs-twoslash/cache-fs";
import type { ShikiTransformer } from "shiki";

/** Only `// ^?` selections get hovers; the annotations are stripped from displayed code. */
export function twoslashHovers(explicitTrigger = true): ShikiTransformer[] {
	return [
		transformerTwoslash({
			explicitTrigger,
			twoslashOptions: {
				// TODO(upstream): TS7.0.2 crashes on Crust builder-method hover queries (DataView RangeError).
				// Keep selections on inferred values until upstream fixes it; never exclude values by name.
				handbookOptions: { noStaticSemanticInfo: true },
			},
			// Separate from the old automatic-hover cache, whose keys include code but not options.
			typesCache: createFileSystemTypesCache({
				dir: "node_modules/.cache/twoslash-selected-hovers",
			}),
		}),
		{
			name: "crust:twoslash-query-hovers",
			preprocess() {
				const result = this.meta.twoslash;
				if (!result) return;
				// Keep explicit queries discoverable on hover rather than adding inline type panels.
				this.meta.twoslash = {
					...result,
					nodes: result.nodes.map((node) =>
						node.type === "query" ? { ...node, type: "hover" } : node,
					),
				};
			},
		},
	];
}
