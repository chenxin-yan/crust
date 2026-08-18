import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CommandSnapshot } from "@crustjs/core/tooling";

import { renderManPageMdoc } from "./mdoc.ts";

export interface WriteManPageOptions {
	/** Prepared, validated Command Snapshot for the CLI. */
	root: CommandSnapshot;
	/** Name for `.Nm` / `man <name>` (usually the installed binary name). */
	name: string;
	/** Output path (e.g. `man/mycli.1`). Parent directories are created. */
	outfile: string;
	/**
	 * Manual section.
	 *
	 * @default 1
	 */
	section?: number;
	/** Override `.Dd` in the mdoc output (see `renderManPageMdoc` `date`). */
	date?: string;
}

/** Render an mdoc(7) manual page from a Command Snapshot and write it to `outfile`. */
export async function writeManPage(options: WriteManPageOptions): Promise<void> {
	const { root, name, outfile, section = 1, date } = options;
	const mdoc = renderManPageMdoc({ root, name, section, date });
	await mkdir(dirname(outfile), { recursive: true });
	await writeFile(outfile, mdoc);
}
