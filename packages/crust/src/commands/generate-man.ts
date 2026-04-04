import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Crust } from "@crustjs/core";
import { writeManPage } from "@crustjs/man";
import { resolveBaseName } from "./binary-name.ts";

export interface GenerateManPageFromEntryOptions {
	cwd: string;
	/** Path to the CLI entry file, relative to `cwd` or absolute */
	entry: string;
	name?: string;
	/** Full path to the `.1` mdoc file to write */
	outfile: string;
}

/**
 * Dynamically import a CLI entry module and write a man page from its exported
 * `Crust` instance (`app` or default export).
 */
export async function generateManPageFromEntry(
	options: GenerateManPageFromEntryOptions,
): Promise<void> {
	const entryPath = resolve(options.cwd, options.entry);
	if (!existsSync(entryPath)) {
		throw new Error(`Entry file not found: ${entryPath}`);
	}

	const href = pathToFileURL(entryPath).href;
	const mod = await import(href);
	const raw =
		(mod as Record<string, unknown>).app ??
		(mod as Record<string, unknown>).default;

	if (!(raw instanceof Crust)) {
		throw new Error(
			`Man generation requires a Crust instance exported as \`app\` or default export from ${options.entry}.`,
		);
	}

	const baseName = resolveBaseName(options.name, entryPath, options.cwd);

	await writeManPage({
		app: raw,
		name: baseName,
		outfile: options.outfile,
	});
}
