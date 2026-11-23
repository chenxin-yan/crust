import { type BuildFile, type ExtensionFactory, defineExtension } from "@crustjs/core";
import {
	buildCommandDocumentation,
	type CommandDocumentation,
	INSTALLED_COMMAND_NAME_RULE,
	isInstalledCommandName,
} from "@crustjs/core/tooling";

import { MAN } from "./id.ts";
import { manPageName, renderCommandPage } from "./mdoc.ts";

export interface ManOptions {
	/** Manual section. Defaults to 1. */
	readonly section?: number;
}

/** Adds build-time mdoc generation: one page per visible command, as `git-commit(1)`. */
export const man: ExtensionFactory<[options?: ManOptions]> = defineExtension(MAN).factory(
	(extension, options = {}) => {
		const section = options.section ?? 1;
		return extension.build(async ({ snapshot }) => {
			const pages: BuildFile[] = [];
			const owners = new Map<string, CommandDocumentation>();
			const visit = (command: CommandDocumentation, parent?: CommandDocumentation) => {
				const name = manPageName(command);
				const where = parent ? ` (command "${command.path.slice(1).join(" ")}")` : "";
				// The page is installed as `man <name>`, and the name is a filename segment.
				if (!isInstalledCommandName(name)) {
					throw new Error(
						`Manual name "${name}"${where} is not a valid command name: use ${INSTALLED_COMMAND_NAME_RULE}.`,
					);
				}
				const owner = owners.get(name);
				if (owner) {
					throw new Error(
						`Commands "${owner.path.join(" ")}" and "${command.path.join(" ")}" both become manual page "${name}"; rename one`,
					);
				}
				owners.set(name, command);
				pages.push({
					path: `man/${name}.${section}`,
					content: renderCommandPage(command, parent, section),
				});
				for (const child of command.children) visit(child, command);
			};
			visit(buildCommandDocumentation(snapshot));
			return pages;
		});
	},
);
