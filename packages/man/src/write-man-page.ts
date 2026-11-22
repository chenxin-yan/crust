import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { renderManPageMdoc, type RenderManPageMdocOptions } from "./mdoc.ts";

export interface WriteManPageOptions extends RenderManPageMdocOptions {
	/**
	 * Output path (e.g. `man/mycli.1`). A relative path resolves against the working
	 * directory. Parent directories are created.
	 */
	outfile: string;
}

/** Render an mdoc(7) manual page from a Command Snapshot and write it to `outfile`. */
export async function writeManPage(options: WriteManPageOptions): Promise<void> {
	const mdoc = renderManPageMdoc(options);
	const outfile = resolve(options.outfile);
	await mkdir(dirname(outfile), { recursive: true });
	await writeFile(outfile, mdoc);
}
