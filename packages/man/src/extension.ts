import { join } from "node:path";

import {
	type Extension,
	type ExtensionId,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

export const MAN: ExtensionId = defineExtensionId("crust:man");

export interface ManOptions {
	/** Manual section. Defaults to 1. */
	readonly section?: number;
	/**
	 * Installed command name used for the page title and filename. Defaults to
	 * the application name; set it when `crust build --name` or the npm bin key
	 * installs the CLI under a different name.
	 */
	readonly name?: string;
}

/** Adds build-time mdoc generation for the application. */
function manFactory(options: ManOptions = {}): Extension {
	const section = options.section ?? 1;
	return defineExtension(MAN, {
		async build({ snapshot, outDir }) {
			const { writeManPage } = await import("./write-man-page.ts");
			const name = options.name ?? snapshot.meta.name;
			await writeManPage({
				root: snapshot,
				name,
				section,
				outfile: join(outDir, "man", `${name}.${section}`),
			});
		},
	});
}

export const man: typeof manFactory & { readonly id: ExtensionId } = Object.assign(manFactory, {
	id: MAN,
});
