import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Crust } from "@crustjs/core";
import { renderManPageMdoc } from "./mdoc.ts";

export interface WriteManPageOptions {
	/** Root Crust builder for your CLI. */
	app: Crust;
	/** Name for `.Nm` / `man <name>` (usually the installed binary name). */
	name: string;
	/** Output path (e.g. `man/mycli.1`). Parent directories are created. */
	outfile: string;
	/** Manual section; defaults to `1`. */
	section?: number;
	/** Synthetic argv passed to plugin `setup()`; defaults to `[]`. */
	argv?: readonly string[];
	/**
	 * When `true` (default), print plugin-setup warnings to `console.warn`.
	 * Set to `false` in tests or CI if you handle warnings yourself.
	 */
	logWarnings?: boolean;
}

/**
 * Freeze and validate the command tree, render an mdoc(7) manual page, and
 * write it to `outfile`.
 */
export async function writeManPage(
	options: WriteManPageOptions,
): Promise<void> {
	const { app, name, outfile, section = 1, argv, logWarnings = true } = options;

	const { root, warnings } = await app.prepareCommandTree({ argv });

	if (logWarnings) {
		for (const w of warnings) {
			console.warn(`Warning: ${w}`);
		}
	}

	const mdoc = renderManPageMdoc({ root, name, section });
	mkdirSync(dirname(outfile), { recursive: true });
	writeFileSync(outfile, mdoc, "utf8");
}
