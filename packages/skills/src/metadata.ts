import type { RenderedFile, SkillKind, SkillMeta } from "./types.ts";
import { CRUST_MANIFEST } from "./version.ts";

/** Renders the ownership and version metadata shipped with a skill. */
export function renderDistributionMetadata(meta: SkillMeta, kind: SkillKind): RenderedFile {
	return {
		path: CRUST_MANIFEST,
		content: `${JSON.stringify(
			{
				name: meta.name,
				description: meta.description,
				version: meta.version,
				kind,
			},
			null,
			"\t",
		)}\n`,
	};
}
