import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { prepareCommandSnapshot } from "@crustjs/core/tooling";

import { renderManPageMdoc } from "./mdoc.ts";

export interface WriteManPageOptions {
	/** Root Crust builder for your CLI. */
	app: Parameters<typeof prepareCommandSnapshot>[0];
	/** Name for `.Nm` / `man <name>` (usually the installed binary name). */
	name: string;
	/** Output path (e.g. `man/mycli.1`). Parent directories are created. */
	outfile: string;
	/** Manual section; defaults to `1`. */
	section?: number;
	/** Override `.Dd` in the mdoc output (see `renderManPageMdoc` `date`). */
	date?: string;
}

/**
 * Freeze and validate the command tree, render an mdoc(7) manual page, and
 * write it to `outfile`.
 */
export async function writeManPage(options: WriteManPageOptions): Promise<void> {
	const { app, name, outfile, section = 1, date } = options;

	const root = await prepareCommandSnapshot(app);

	const mdoc = renderManPageMdoc({ root, name, section, date });
	mkdirSync(dirname(outfile), { recursive: true });
	writeFileSync(outfile, mdoc, "utf8");
}
