import { resolve } from "node:path";

import type { CommandSnapshot } from "@crustjs/core/tooling";
import { writeManPage } from "@crustjs/man";

import { resolveBaseName } from "./binary-name.ts";

export interface GenerateManPageOptions {
	cwd: string;
	/** Prepared Command Snapshot for the CLI entry. */
	root: CommandSnapshot;
	/** Path to the CLI entry file, used to infer the binary name. */
	entry: string;
	name?: string;
	/** Full path to the `.1` mdoc file to write. */
	outfile: string;
}

/** Write a man page from an already prepared Command Snapshot. */
export async function generateManPage(options: GenerateManPageOptions): Promise<void> {
	const entryPath = resolve(options.cwd, options.entry);
	const baseName = resolveBaseName(options.name, entryPath, options.cwd);

	await writeManPage({
		root: options.root,
		name: baseName,
		outfile: options.outfile,
	});
}
