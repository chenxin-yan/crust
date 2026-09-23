/**
 * Programmatic entry of `@crustjs/crust`: the `crust build` pipeline as a
 * function. The CLI itself lives in `cli.ts`, which executes on import and is
 * deliberately not exported here.
 */
export { build, type BuildOptions, type BuildResult } from "./commands/build.ts";
export type { BuildArtifact } from "./utils/distribute.ts";
export type { BuildReport } from "@crustjs/core";
