import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Crust } from "@crustjs/core";
import {
  buildCommandDocumentation,
  type CommandSnapshot,
  SNAPSHOT_PATH_ENV,
} from "@crustjs/core/tooling";

import { buildCommand } from "../../../packages/crust/src/commands/build.ts";
import { publishCommand } from "../../../packages/crust/src/commands/publish.ts";
import {
  BUILD_RUNTIMES,
  BUN_TARGETS,
  DENO_TARGETS,
} from "../../../packages/crust/src/utils/build-helpers.ts";
import { markdownTable } from "./cli-reference.ts";

const root = resolve(import.meta.dir, "../../..");
const read = (path: string) => readFile(join(root, path), "utf8");

// Descriptions and effective runtime/prompt defaults are authored, not snapshot facts.
function flagRows(snapshot: CommandSnapshot): string[][] {
  return buildCommandDocumentation(snapshot).flags.map((flag) => [
    flag.spellings.join(", "),
    `${flag.type}${flag.multiple ? " (repeatable)" : ""}`,
    flag.choices?.join(", ") ?? "—",
    flag.default === undefined ? "—" : JSON.stringify(flag.default),
  ]);
}

describe("CLI reference parity", () => {
  it("reads only the selected table, preserves escaped pipes, and rejects missing tables", () => {
    const text =
      "## Options\n\nAuthored prose.\n\n| Flag | Choices |\n| --- | --- |\n| `--mode` | `a\\|b` |\n\n## Other\n\n| X |\n| --- |\n| y |\n";
    expect(markdownTable(text, "## Options")).toEqual([["--mode", "a|b"]]);
    expect(markdownTable(text.replace("## Other", "Other table:"), "## Options")).toEqual([
      ["--mode", "a|b"],
    ]);
    expect(
      markdownTable(
        text.replace("Authored prose.", "```sh\n# Shell comment, not a heading\n```"),
        "## Options",
      ),
    ).toEqual([["--mode", "a|b"]]);
    expect(() => markdownTable(text, "## Missing")).toThrow("## Missing");
    expect(() =>
      markdownTable("## Options\n\n## Other\n| X |\n| --- |\n| y |", "## Options"),
    ).toThrow("## Options");
  });

  it("matches build/publish spellings, types, multiplicity, choices and declared defaults", async () => {
    const snapshot = await new Crust("crust").add(buildCommand, publishCommand).snapshot();
    const page = await read("apps/docs/content/docs/guide/build.mdx");
    expect(markdownTable(page, "## Flags").map((row) => row.slice(0, 4))).toEqual(
      flagRows(snapshot.subCommands.build),
    );
    expect(
      markdownTable(page, "### Publishing with `crust publish`").map((row) => row.slice(0, 4)),
    ).toEqual(flagRows(snapshot.subCommands.publish));
    expect(snapshot.subCommands.build.flags.minify.default).toBeUndefined();
    expect(snapshot.subCommands.build.flags.runtime.default).toBeUndefined();
  });

  it("matches complete runtime and canonical target inventories in source order", async () => {
    const page = await read("apps/docs/content/docs/guide/build.mdx");
    expect(markdownTable(page, "## Runtime Outputs").map((row) => row[0].toLowerCase())).toEqual([
      ...BUILD_RUNTIMES,
    ]);
    for (const targets of [BUN_TARGETS, DENO_TARGETS]) {
      expect(
        markdownTable(page, `### Supported ${targets.runtime} targets`).map((row) => row[0]),
      ).toEqual([...targets.targets]);
    }
  });

  it("matches scaffold options in both the module page and README without running its action", async () => {
    const temp = await mkdtemp(join(tmpdir(), "crust-docs-snapshot-"));
    try {
      const snapshotPath = join(temp, "snapshot.json");
      const result = Bun.spawnSync(["node", join(root, "packages/create-crust/dist/index.js")], {
        cwd: temp,
        env: { ...process.env, [SNAPSHOT_PATH_ENV]: snapshotPath },
        timeout: 10_000,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as CommandSnapshot;
      expect(snapshot.meta.name).toBe("create-crust");
      for (const path of [
        "apps/docs/content/docs/modules/create-crust.mdx",
        "packages/create-crust/README.md",
      ]) {
        expect(markdownTable(await read(path), "## Options").map((row) => row.slice(0, 4))).toEqual(
          flagRows(snapshot),
        );
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
