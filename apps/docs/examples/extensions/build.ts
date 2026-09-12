import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Crust, type BuildArtifacts, defineExtension, defineExtensionId } from "@crustjs/core";

export const manifest = defineExtension(defineExtensionId("acme:manifest"), {
  async build({ snapshot, outDir }) {
    const artifactDir = join(outDir, "acme-manifest");
    await rm(artifactDir, { recursive: true, force: true });
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "manifest.json"), JSON.stringify(snapshot));
    return ["acme-manifest/manifest.json"] satisfies BuildArtifacts;
  },
});

export const app = new Crust("my-cli").extend(manifest).action(() => {});

await app.execute();
