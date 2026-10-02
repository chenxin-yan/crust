import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { renderManPageMdoc, type RenderManPageMdocOptions } from "./mdoc.ts";

export interface WriteManPageOptions extends RenderManPageMdocOptions {
	/** Output path (e.g. `man/mycli.1`). Parent directories are created. */
	outfile: string;
}

/** Render an mdoc(7) manual page from a Command Snapshot and write it to `outfile`. */
export async function writeManPage(options: WriteManPageOptions): Promise<void> {
	const mdoc = renderManPageMdoc(options);
	await mkdir(dirname(options.outfile), { recursive: true });
	await writeFile(options.outfile, mdoc);
}
