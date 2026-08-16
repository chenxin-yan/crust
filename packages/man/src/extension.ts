import { join } from "node:path";

import { type Extension, defineExtension } from "@crustjs/core";

export interface ManOptions {
	/** Manual section. Defaults to 1. */
	readonly section?: number;
}

/** Adds build-time mdoc generation for the application. */
export function man(options: ManOptions = {}): Extension {
	const section = options.section ?? 1;
	return defineExtension("man", {
		async build({ snapshot, outDir }) {
			const { writeManPage } = await import("./write-man-page.ts");
			await writeManPage({
				root: snapshot,
				name: snapshot.meta.name,
				section,
				outfile: join(outDir, "man", `${snapshot.meta.name}.${section}`),
			});
		},
	});
}
