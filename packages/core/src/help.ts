import type {
	AnyCommand,
	ArgsDef,
	Command,
	FlagDef,
	FlagsDef,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// formatVersion
// ────────────────────────────────────────────────────────────────────────────

/**
 * Format the version string for a command.
 *
 * Returns `"<name> v<version>"` when a version string is provided,
 * otherwise `"<name> (no version)"`.
 *
 * The version is an app-level concern and should be passed from the CLI
 * configuration rather than read from individual command metadata.
 *
 * @param command - The command whose name is used in the output
 * @param version - The application version string (e.g. "1.0.0")
 * @returns The formatted version string
 */
export function formatVersion(command: AnyCommand, version?: string): string {
	const { name } = command.meta;
	if (version) {
		return `${name} v${version}`;
	}
	return `${name} (no version)`;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Determine the type hint for a flag based on its type constructor.
 */
function flagTypeHint(def: FlagDef): string {
	if (def.type === Number) return "<number>";
	if (def.type === String) return "<string>";
	return "";
}

/**
 * Determine the type name for a positional arg (for display in help text).
 */
function argTypeName(
	type: StringConstructor | NumberConstructor | BooleanConstructor,
): string {
	if (type === Number) return "number";
	if (type === String) return "string";
	if (type === Boolean) return "boolean";
	return "string";
}

/**
 * Pad all rows so that each column aligns.
 * Returns an array of formatted row strings.
 */
function alignColumns(rows: string[][], gutter = 2): string[] {
	if (rows.length === 0) return [];

	// Determine the max width for each column (except the last)
	const colCount = Math.max(...rows.map((r) => r.length));
	const widths: number[] = Array.from({ length: colCount }, () => 0);

	for (const row of rows) {
		for (let i = 0; i < row.length - 1; i++) {
			const cell = row[i] ?? "";
			widths[i] = Math.max(widths[i] ?? 0, cell.length);
		}
	}

	return rows.map((row) => {
		return row
			.map((cell, i) => {
				if (i === row.length - 1) return cell; // last column: no padding
				return cell.padEnd((widths[i] ?? 0) + gutter);
			})
			.join("");
	});
}

/**
 * Check if the user has defined a flag with a given name.
 */
function userHasFlag(flags: FlagsDef | undefined, name: string): boolean {
	if (!flags) return false;
	return name in flags;
}

/**
 * Check if the user has an alias that collides with a given alias.
 */
function userHasAlias(flags: FlagsDef | undefined, alias: string): boolean {
	if (!flags) return false;
	for (const def of Object.values(flags) as FlagDef[]) {
		if (def.alias) {
			const aliases = Array.isArray(def.alias) ? def.alias : [def.alias];
			if (aliases.includes(alias)) return true;
		}
	}
	return false;
}

/**
 * Build the short-alias portion for a flag (e.g., "-v" or "-o").
 * Returns the formatted alias string, or empty string if no short alias.
 */
function buildFlagAliasCol(def: FlagDef): string {
	if (!def.alias) return "";
	const aliases = Array.isArray(def.alias) ? def.alias : [def.alias];
	// Find the first single-char alias for the short form
	const shortAlias = aliases.find((a) => a.length === 1);
	if (shortAlias) {
		return `-${shortAlias}`;
	}
	return "";
}

// ────────────────────────────────────────────────────────────────────────────
// formatHelp
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generate formatted help text from a command's metadata, args, flags, and subcommands.
 *
 * The output includes:
 * - Description (if present)
 * - Usage line
 * - Arguments section (if the command has positional args)
 * - Flags/Options section (including built-in --help and --version)
 * - Subcommands section (if the command has subcommands)
 *
 * @param command - The command to generate help text for
 * @param commandPath - The command path for nested subcommands (e.g. ["crust", "generate"])
 * @returns The formatted help text string
 */
export function formatHelp(
	// biome-ignore lint/suspicious/noExplicitAny: works with any command generics
	command: Command<any, any>,
	commandPath?: string[],
): string {
	const lines: string[] = [];
	const meta = command.meta;
	const args: ArgsDef | undefined = command.args;
	const flags: FlagsDef | undefined = command.flags;
	const subCommands: Record<string, Command<ArgsDef, FlagsDef>> | undefined =
		command.subCommands as
			| Record<string, Command<ArgsDef, FlagsDef>>
			| undefined;
	const cmdPath = commandPath ? commandPath.join(" ") : meta.name;

	// ── Description ──────────────────────────────────────────────────
	if (meta.description) {
		lines.push(meta.description);
		lines.push("");
	}

	// ── Usage line ───────────────────────────────────────────────────
	if (meta.usage) {
		lines.push(`USAGE: ${meta.usage}`);
	} else {
		const usageParts: string[] = [cmdPath];

		if (subCommands && Object.keys(subCommands).length > 0) {
			usageParts.push("<command>");
		}

		// Positional args in usage
		if (args) {
			for (const def of args) {
				if (def.variadic) {
					usageParts.push(
						def.required !== false ? `<${def.name}...>` : `[${def.name}...]`,
					);
				} else if (def.required === true) {
					usageParts.push(`<${def.name}>`);
				} else {
					usageParts.push(`[${def.name}]`);
				}
			}
		}

		// Always show [options] since we have at least --help/--version
		usageParts.push("[options]");

		lines.push(`USAGE: ${usageParts.join(" ")}`);
	}
	lines.push("");

	// ── Arguments section ────────────────────────────────────────────
	if (args && args.length > 0) {
		lines.push("ARGUMENTS:");

		const argRows: string[][] = [];
		for (const def of args) {
			const nameCol = def.variadic ? `  ${def.name}...` : `  ${def.name}`;
			const parts: string[] = [];

			if (def.description) {
				parts.push(def.description);
			}

			// Type info
			parts.push(`(${argTypeName(def.type)})`);

			if (def.required === true) {
				parts.push("[required]");
			}

			if (def.default !== undefined) {
				parts.push(`(default: ${JSON.stringify(def.default)})`);
			}

			argRows.push([nameCol, parts.join(" ")]);
		}

		for (const line of alignColumns(argRows)) {
			lines.push(line);
		}
		lines.push("");
	}

	// ── Flags/Options section ────────────────────────────────────────
	const flagRows: string[][] = [];

	// User-defined flags
	if (flags) {
		for (const [name, def] of Object.entries(flags) as [string, FlagDef][]) {
			const aliasCol = buildFlagAliasCol(def);
			const nameWithHint =
				def.type === Boolean ? `--${name}` : `--${name}=${flagTypeHint(def)}`;
			const nameCol = aliasCol
				? `${aliasCol}, ${nameWithHint}`
				: `    ${nameWithHint}`;

			const parts: string[] = [];
			if (def.description) {
				parts.push(def.description);
			}
			if (def.required === true) {
				parts.push("[required]");
			}
			if (def.default !== undefined) {
				parts.push(`(default: ${JSON.stringify(def.default)})`);
			}

			flagRows.push([`  ${nameCol}`, parts.join(" ")]);
		}
	}

	// Built-in --help flag (unless user defines their own)
	if (!userHasFlag(flags, "help")) {
		const helpAlias = userHasAlias(flags, "h") ? "    " : "-h, ";
		flagRows.push([`  ${helpAlias}--help`, "Show this help message"]);
	}

	// Built-in --version flag (unless user defines their own)
	if (!userHasFlag(flags, "version")) {
		const versionAlias = userHasAlias(flags, "v") ? "    " : "-v, ";
		flagRows.push([`  ${versionAlias}--version`, "Show version number"]);
	}

	if (flagRows.length > 0) {
		lines.push("OPTIONS:");
		for (const line of alignColumns(flagRows)) {
			lines.push(line);
		}
		lines.push("");
	}

	// ── Subcommands section ──────────────────────────────────────────
	if (subCommands && Object.keys(subCommands).length > 0) {
		lines.push("COMMANDS:");

		const cmdRows: string[][] = [];
		for (const [name, sub] of Object.entries(subCommands)) {
			const desc = sub.meta.description ?? "";
			cmdRows.push([`  ${name}`, desc]);
		}

		for (const line of alignColumns(cmdRows)) {
			lines.push(line);
		}
		lines.push("");

		lines.push(`Use "${cmdPath} <command> --help" for more information.`);
		lines.push("");
	}

	// Remove trailing blank line
	while (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}

	return lines.join("\n");
}
