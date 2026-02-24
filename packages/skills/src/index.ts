// ────────────────────────────────────────────────────────────────────────────
// @crustjs/skills — Agent skill generation from Crust command definitions
// ────────────────────────────────────────────────────────────────────────────

export { generateSkill } from "./generate.ts";

// Generation API
export { buildManifest } from "./manifest.ts";
export { renderSkill } from "./render.ts";
// Generation types
export type {
	GenerateOptions,
	GenerateResult,
	ManifestArg,
	ManifestFlag,
	ManifestNode,
	RenderedFile,
	SkillMeta,
	WriteOptions,
} from "./types.ts";
