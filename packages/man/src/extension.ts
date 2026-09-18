import {
	type ExtensionFactory,
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
	 * the application name; set it when the npm bin key installs the CLI under a
	 * different name.
	 */
	readonly name?: string;
}

/** Adds build-time mdoc generation for the application. */
export const man: ExtensionFactory<[options?: ManOptions]> = defineExtension(
	MAN,
	(options = {}) => {
		const section = options.section ?? 1;
		return {
			async build({ snapshot }) {
				const { renderManPageMdoc } = await import("./mdoc.ts");
				const name = options.name ?? snapshot.meta.name;
				// The name is a filename segment; a separator would nest the page where
				// npm's `man` field and `man -l` would not find it.
				if (/[\\/]/.test(name)) {
					throw new Error(`Manual name "${name}" must not contain path separators.`);
				}
				return [
					{
						path: `man/${name}.${section}`,
						content: renderManPageMdoc({ root: snapshot, name, section }),
					},
				];
			},
		};
	},
);
