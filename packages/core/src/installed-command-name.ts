// The root command name is the installed command, and tooling turns it into
// `bin/<name>.js`, `<name>-<target>` binaries, launcher text, project names, and
// shell completion programs and filenames. A leading letter or digit keeps it
// from reading as an option (`-x`), a hidden file (`.x`), or a private name (`_x`).
const INSTALLED_COMMAND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** {@link isInstalledCommandName}'s rule as prose, for error messages: "Use <rule>." */
export const INSTALLED_COMMAND_NAME_RULE =
	'letters, digits, ".", "_", and "-", starting with a letter or digit';

/**
 * Whether `name` is valid as an installed command name: the `bin` keys
 * `crust build` accepts, the project names `create-crust` scaffolds, and the
 * root names shell completion targets.
 */
export function isInstalledCommandName(name: string): boolean {
	return INSTALLED_COMMAND_NAME_PATTERN.test(name);
}
