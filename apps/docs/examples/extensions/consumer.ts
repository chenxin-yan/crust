import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Crust, defineCommand, defineExtension, defineExtensionId } from "@crustjs/core";
import { visibleSectionsFor } from "@crustjs/core/tooling";

const WEB_DOCS = defineExtensionId("acme:web-docs");

export const webDocs = defineExtension(WEB_DOCS, {
  async build({ snapshot, outDir }) {
    const lines = visibleSectionsFor(snapshot, WEB_DOCS).flatMap(({ path, sections }) => [
      `# ${[snapshot.meta.name, ...path].join(" ")}`,
      ...sections.map((s) => `## ${s.title}\n${s.body}`),
    ]);
    await writeFile(join(outDir, "docs.md"), lines.join("\n\n"));
    return ["docs.md"];
  },
});

const deploy = defineCommand(
  "deploy",
  {
    sections: [
      { title: "Safety", body: "Run preview first." },
      { title: "Screenshots", body: "![preview](preview.png)", only: [webDocs] },
    ],
  },
  (command) => command.action(() => {}),
);

export const app = new Crust("my-cli").add(deploy).extend(webDocs);
