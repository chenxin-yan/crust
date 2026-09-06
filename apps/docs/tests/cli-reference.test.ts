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

const root = resolve(import.meta.dir, "../../..");
const read = (path: string) => readFile(join(root, path), "utf8");

/** Read the first Markdown table beneath an exact heading for CLI parity checks. */
function markdownTable(markdown: string, heading: string): string[][] {
  const lines = markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "").split("\n");
  const start = lines.indexOf(heading);
  if (start !== -1) {
    const section = lines.slice(start + 1);
    const end = section.findIndex((line) => /^#{1,6} /.test(line));
    const body = end === -1 ? section : section.slice(0, end);
    const tableStart = body.findIndex((line) => line.startsWith("|"));
    const remainder = tableStart === -1 ? [] : body.slice(tableStart);
    const tableEnd = remainder.findIndex((line) => !line.startsWith("|"));
    const table = tableEnd === -1 ? remainder : remainder.slice(0, tableEnd);
    if (table.length >= 2 && /^\|[\s:|-]+\|$/.test(table[1])) {
      return table.slice(2).map((line) =>
        line
          .slice(1, line.lastIndexOf("|"))
          .split(/(?<!\\)\|/)
          .map((cell) => cell.trim().replaceAll("`", "").replaceAll("\\|", "|")),
      );
    }
  }
  throw new Error(`Missing CLI reference table under ${heading}`);
}

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
  it("matches build/publish spellings, types, multiplicity, choices and declared defaults", async () => {
    const snapshot = await new Crust("crust").add(buildCommand, publishCommand).snapshot();
    const page = await read("apps/docs/content/docs/guide/build.mdx");
    expect(markdownTable(page, "## Flags").map((row) => row.slice(0, 4))).toEqual(
      flagRows(snapshot.subCommands.build),
    );
    expect(
      markdownTable(page, "### Publishing with `crust publish`").map((row) => row.slice(0, 4)),
    ).toEqual(flagRows(snapshot.subCommands.publish));
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

  it("matches scaffold options in the module page without running its action", async () => {
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
      expect(result.exitCode).toBe(0);
      const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as CommandSnapshot;
      const page = await read("apps/docs/content/docs/modules/create-crust.mdx");
      expect(markdownTable(page, "## Options").map((row) => row.slice(0, 4))).toEqual(
        flagRows(snapshot),
      );
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
