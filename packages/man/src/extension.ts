import { type ExtensionFactory, defineExtension } from "@crustjs/core";

import { MAN } from "./id.ts";
import { renderManPageMdoc } from "./mdoc.ts";

export interface ManOptions {
	/** Manual section. Defaults to 1. */
	readonly section?: number;
}

/** Adds build-time mdoc generation for the application. */
export const man: ExtensionFactory<[options?: ManOptions]> = defineExtension(MAN).factory(
	(extension, options = {}) => {
		const section = options.section ?? 1;
		return extension.build(async ({ snapshot }) => {
			const { name } = snapshot.meta;
			// The name is a filename segment; a separator would nest the page where
			// npm's `man` field and `man -l` would not find it.
			if (/[\\/]/.test(name)) {
				throw new Error(`Manual name "${name}" must not contain path separators.`);
			}
			return [
				{
					path: `man/${name}.${section}`,
					content: renderManPageMdoc({ root: snapshot, section }),
				},
			];
		});
	},
);
