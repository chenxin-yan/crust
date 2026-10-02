import { type ExtensionFactory, defineExtension } from "@crustjs/core";
import { INSTALLED_COMMAND_NAME_RULE, isInstalledCommandName } from "@crustjs/core/tooling";

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
			// The page is installed as `man <name>`, and the name is a filename segment.
			if (!isInstalledCommandName(name)) {
				throw new Error(
					`Manual name "${name}" is not a valid command name: use ${INSTALLED_COMMAND_NAME_RULE}.`,
				);
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
