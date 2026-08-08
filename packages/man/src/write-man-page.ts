import type { CommandSnapshot } from "@crustjs/core/tooling";

import { renderManPageMdoc } from "./mdoc.ts";

export interface WriteManPageOptions {
	/** Root Crust builder for your CLI, typed structurally across bundled entry points. */
	app: { snapshot(): Promise<CommandSnapshot> };
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

/**
 * Freeze and validate the command tree, render an mdoc(7) manual page, and
 * write it to `outfile`.
 */
export async function writeManPage(options: WriteManPageOptions): Promise<void> {
	const { app, name, outfile, section = 1, date } = options;

	const root = await app.snapshot();

	const mdoc = renderManPageMdoc({ root, name, section, date });
	await Bun.write(outfile, mdoc);
}
