import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Crust, type BuildArtifacts, defineExtension, defineExtensionId } from "@crustjs/core";

export const manifest = defineExtension(defineExtensionId("acme:manifest"), {
  async build({ snapshot, outDir }) {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "manifest.json"), JSON.stringify(snapshot));
    return ["manifest.json"] satisfies BuildArtifacts;
  },
});

export const app = new Crust("my-cli").extend(manifest).action(() => {});
