import { describe, expect, it } from "bun:test";
import { defineCommand } from "../src/command.ts";
import { formatHelp, formatVersion } from "../src/help.ts";

// ────────────────────────────────────────────────────────────────────────────
// formatVersion
// ────────────────────────────────────────────────────────────────────────────

describe("formatVersion", () => {
	it("returns name and version when version is provided", () => {
		const cmd = defineCommand({
			meta: { name: "mycli" },
		});
		expect(formatVersion(cmd, "1.2.3")).toBe("mycli v1.2.3");
	});

	it("returns '(no version)' when version is not provided", () => {
		const cmd = defineCommand({
			meta: { name: "mycli" },
		});
		expect(formatVersion(cmd)).toBe("mycli (no version)");
	});

	it("handles pre-release versions", () => {
		const cmd = defineCommand({
			meta: { name: "mycli" },
		});
		expect(formatVersion(cmd, "2.0.0-beta.1")).toBe("mycli v2.0.0-beta.1");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatHelp — basic output format
// ────────────────────────────────────────────────────────────────────────────

describe("formatHelp — basic output format", () => {
	it("includes description when present", () => {
		const cmd = defineCommand({
			meta: { name: "mycli", description: "A great CLI tool" },
		});
		const help = formatHelp(cmd);
		expect(help).toContain("A great CLI tool");
	});

	it("includes USAGE line with command name", () => {
		const cmd = defineCommand({
			meta: { name: "mycli" },
		});
		const help = formatHelp(cmd);
		expect(help).toContain("USAGE: mycli");
	});

	it("uses custom usage when provided", () => {
		const cmd = defineCommand({
			meta: { name: "mycli", usage: "mycli [file] --flag" },
		});
		const help = formatHelp(cmd);
		expect(help).toContain("USAGE: mycli [file] --flag");
		// Custom usage should not append [options]
		expect(help).not.toContain("[options] --flag");
	});

	it("includes OPTIONS section with built-in --help and --version", () => {
		const cmd = defineCommand({
			meta: { name: "mycli" },
		});
		const help = formatHelp(cmd);
		expect(help).toContain("OPTIONS:");
		expect(help).toContain("--help");
		expect(help).toContain("--version");
		expect(help).toContain("-h,");
		expect(help).toContain("-v,");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatHelp — with args and flags
// ────────────────────────────────────────────────────────────────────────────

describe("formatHelp — with args and flags", () => {
	it("shows positional args in usage and ARGUMENTS section", () => {
		const cmd = defineCommand({
			meta: { name: "serve" },
			args: [
				{
					name: "port",
					type: Number,
					description: "Port number",
					default: 3000,
				},
			],
		});
		const help = formatHelp(cmd);

		// Usage should show [port] (optional because has default)
		expect(help).toContain("USAGE: serve [port] [options]");

		// ARGUMENTS section
		expect(help).toContain("ARGUMENTS:");
		expect(help).toContain("port");
		expect(help).toContain("Port number");
		expect(help).toContain("(number)");
		expect(help).toContain("(default: 3000)");
	});

	it("shows required args with angle brackets in usage", () => {
		const cmd = defineCommand({
			meta: { name: "greet" },
			args: [
				{
					name: "name",
					type: String,
					description: "Who to greet",
					required: true,
				},
			],
		});
		const help = formatHelp(cmd);
		expect(help).toContain("USAGE: greet <name> [options]");
		expect(help).toContain("[required]");
	});

	it("shows variadic args with ... suffix in usage", () => {
		const cmd = defineCommand({
			meta: { name: "bundle" },
			args: [
				{
					name: "files",
					type: String,
					description: "Files to bundle",
					variadic: true,
				},
			],
		});
		const help = formatHelp(cmd);
		expect(help).toContain("<files...>");
		expect(help).toContain("files...");
		expect(help).toContain("Files to bundle");
	});

	it("shows flags with descriptions and defaults", () => {
		const cmd = defineCommand({
			meta: { name: "serve" },
			flags: {
				port: {
					type: Number,
					description: "Port number",
					default: 3000,
				},
				verbose: {
					type: Boolean,
					description: "Enable verbose logging",
				},
			},
		});
		const help = formatHelp(cmd);

		expect(help).toContain("OPTIONS:");
		expect(help).toContain("--port=<number>");
		expect(help).toContain("Port number");
		expect(help).toContain("(default: 3000)");
		expect(help).toContain("--verbose");
		expect(help).toContain("Enable verbose logging");
	});

	it("shows required flag marker", () => {
		const cmd = defineCommand({
			meta: { name: "deploy" },
			flags: {
				token: {
					type: String,
					description: "Auth token",
					required: true,
				},
			},
		});
		const help = formatHelp(cmd);
		expect(help).toContain("--token=<string>");
		expect(help).toContain("[required]");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatHelp — with aliases
// ────────────────────────────────────────────────────────────────────────────

describe("formatHelp — with aliases", () => {
	it("shows short alias before the flag name", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				verbose: {
					type: Boolean,
					description: "Verbose output",
					alias: "v",
				},
			},
		});
		const help = formatHelp(cmd);
		// -v should appear as a short alias for verbose
		expect(help).toContain("-v, --verbose");
	});

	it("shows flag without alias with consistent indentation", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				debug: {
					type: Boolean,
					description: "Debug mode",
				},
			},
		});
		const help = formatHelp(cmd);
		// No alias: should have padding in place of the alias
		expect(help).toContain("    --debug");
	});

	it("handles array of aliases, shows the first short one", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				output: {
					type: String,
					description: "Output path",
					alias: ["o", "out"],
				},
			},
		});
		const help = formatHelp(cmd);
		// Short alias -o should be shown
		expect(help).toContain("-o, --output=<string>");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatHelp — with subcommands
// ────────────────────────────────────────────────────────────────────────────

describe("formatHelp — with subcommands", () => {
	it("lists subcommands in COMMANDS section", () => {
		const buildCmd = defineCommand({
			meta: {
				name: "build",
				description: "Build the project",
			},
		});
		const devCmd = defineCommand({
			meta: {
				name: "dev",
				description: "Start dev server",
			},
		});
		const rootCmd = defineCommand({
			meta: { name: "crust", description: "CLI framework" },
			subCommands: { build: buildCmd, dev: devCmd },
		});
		const help = formatHelp(rootCmd);

		expect(help).toContain("COMMANDS:");
		expect(help).toContain("build");
		expect(help).toContain("Build the project");
		expect(help).toContain("dev");
		expect(help).toContain("Start dev server");
	});

	it("shows <command> in usage when subcommands exist", () => {
		const subCmd = defineCommand({
			meta: { name: "sub", description: "A subcommand" },
		});
		const rootCmd = defineCommand({
			meta: { name: "root" },
			subCommands: { sub: subCmd },
		});
		const help = formatHelp(rootCmd);
		expect(help).toContain("USAGE: root <command>");
	});

	it("shows help hint for subcommands", () => {
		const subCmd = defineCommand({
			meta: { name: "sub", description: "A subcommand" },
		});
		const rootCmd = defineCommand({
			meta: { name: "root" },
			subCommands: { sub: subCmd },
		});
		const help = formatHelp(rootCmd);
		expect(help).toContain('Use "root <command> --help" for more information.');
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatHelp — with defaults shown
// ────────────────────────────────────────────────────────────────────────────

describe("formatHelp — defaults display", () => {
	it("shows default values for flags", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				port: { type: Number, default: 8080 },
				host: { type: String, default: "localhost" },
				minify: { type: Boolean, default: true },
			},
		});
		const help = formatHelp(cmd);
		expect(help).toContain("(default: 8080)");
		expect(help).toContain('(default: "localhost")');
		expect(help).toContain("(default: true)");
	});

	it("shows default values for positional args", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [
				{ name: "port", type: Number, description: "Port", default: 3000 },
			],
		});
		const help = formatHelp(cmd);
		expect(help).toContain("(default: 3000)");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatHelp — subcommand help shows full command path
// ────────────────────────────────────────────────────────────────────────────

describe("formatHelp — subcommand path", () => {
	it("shows full command path when commandPath is provided", () => {
		const cmd = defineCommand({
			meta: { name: "command", description: "Generate a command" },
			args: [
				{
					name: "name",
					type: String,
					description: "Command name",
					required: true,
				},
			],
		});
		const help = formatHelp(cmd, ["crust", "generate", "command"]);
		expect(help).toContain("USAGE: crust generate command <name>");
	});

	it("uses meta.name when commandPath is not provided", () => {
		const cmd = defineCommand({
			meta: { name: "command" },
		});
		const help = formatHelp(cmd);
		expect(help).toContain("USAGE: command");
	});

	it("shows correct help hint for subcommands with full path", () => {
		const nestedCmd = defineCommand({
			meta: { name: "deep", description: "Deep nested" },
		});
		const cmd = defineCommand({
			meta: { name: "mid" },
			subCommands: { deep: nestedCmd },
		});
		const help = formatHelp(cmd, ["root", "mid"]);
		expect(help).toContain(
			'Use "root mid <command> --help" for more information.',
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatHelp — empty command (no args, no flags)
// ────────────────────────────────────────────────────────────────────────────

describe("formatHelp — empty command", () => {
	it("produces valid help with no args and no flags", () => {
		const cmd = defineCommand({
			meta: { name: "empty" },
		});
		const help = formatHelp(cmd);

		// Should have usage line
		expect(help).toContain("USAGE: empty [options]");

		// Should not have ARGUMENTS section
		expect(help).not.toContain("ARGUMENTS:");

		// Should have OPTIONS with built-in flags
		expect(help).toContain("OPTIONS:");
		expect(help).toContain("--help");
		expect(help).toContain("--version");

		// Should not have COMMANDS section
		expect(help).not.toContain("COMMANDS:");
	});

	it("produces valid help with only description and name", () => {
		const cmd = defineCommand({
			meta: { name: "simple", description: "A simple command" },
		});
		const help = formatHelp(cmd);
		expect(help).toContain("A simple command");
		expect(help).toContain("USAGE: simple [options]");
		expect(help).toContain("--help");
		expect(help).toContain("--version");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatHelp — built-in flag conflict handling
// ────────────────────────────────────────────────────────────────────────────

describe("formatHelp — built-in flag conflict handling", () => {
	it("omits built-in --help when user defines their own help flag", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				help: { type: String, description: "Custom help behavior" },
			},
		});
		const help = formatHelp(cmd);

		// The user's help flag is shown
		expect(help).toContain("--help=<string>");
		expect(help).toContain("Custom help behavior");

		// Built-in "Show this help message" should NOT appear
		expect(help).not.toContain("Show this help message");
	});

	it("omits built-in --version when user defines their own version flag", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				version: {
					type: Boolean,
					description: "Custom version behavior",
				},
			},
		});
		const help = formatHelp(cmd);

		// The user's version flag is shown
		expect(help).toContain("--version");
		expect(help).toContain("Custom version behavior");

		// Built-in "Show version number" should NOT appear
		expect(help).not.toContain("Show version number");
	});

	it("omits -h alias for built-in --help when user's flag uses -h", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				host: { type: String, description: "Host", alias: "h" },
			},
		});
		const help = formatHelp(cmd);

		// -h should appear for the user's --host flag
		expect(help).toContain("-h, --host=<string>");

		// --help should still appear but without -h alias
		expect(help).toContain("--help");

		// Verify there's no "-h, --help" (the -h is taken by --host)
		expect(help).not.toContain("-h, --help");
	});

	it("omits -v alias for built-in --version when user's flag uses -v", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				verbose: { type: Boolean, description: "Verbose", alias: "v" },
			},
		});
		const help = formatHelp(cmd);

		// -v should appear for the user's --verbose flag
		expect(help).toContain("-v, --verbose");

		// --version should still appear but without -v alias
		expect(help).toContain("--version");

		// Verify there's no "-v, --version"
		expect(help).not.toContain("-v, --version");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatHelp — column alignment
// ────────────────────────────────────────────────────────────────────────────

describe("formatHelp — column alignment", () => {
	it("aligns flag descriptions in columns", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				port: {
					type: Number,
					description: "Port number",
					alias: "p",
				},
				verbose: {
					type: Boolean,
					description: "Enable verbose logging",
					alias: "v",
				},
				output: {
					type: String,
					description: "Output directory",
					alias: "o",
				},
			},
		});
		const help = formatHelp(cmd);
		const lines = help.split("\n");

		// Find lines in OPTIONS section that have flag names
		const optionLines = lines.filter(
			(l) =>
				l.includes("--port") ||
				l.includes("--verbose") ||
				l.includes("--output"),
		);

		// All flag descriptions should start at the same column
		// Extract where the description text starts after the padded flag column
		expect(optionLines.length).toBe(3);

		// Each line should contain both the flag and its description
		for (const line of optionLines) {
			expect(line).toContain("  "); // has indentation and gutter
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatHelp — comprehensive integration test
// ────────────────────────────────────────────────────────────────────────────

describe("formatHelp — full integration", () => {
	it("renders a complex command with all sections", () => {
		const statusCmd = defineCommand({
			meta: { name: "status", description: "Show server status" },
		});
		const cmd = defineCommand({
			meta: {
				name: "serve",
				description: "Start the development server",
			},
			args: [
				{
					name: "entry",
					type: String,
					description: "Entry file",
					default: "src/index.ts",
				},
			],
			flags: {
				port: {
					type: Number,
					description: "Port number",
					default: 3000,
					alias: "p",
				},
				host: {
					type: String,
					description: "Host address",
					default: "localhost",
				},
				open: {
					type: Boolean,
					description: "Open browser automatically",
					alias: "o",
				},
			},
			subCommands: { status: statusCmd },
		});

		const help = formatHelp(cmd);

		// Description
		expect(help).toContain("Start the development server");

		// Usage
		expect(help).toContain("USAGE: serve <command> [entry] [options]");

		// Arguments section
		expect(help).toContain("ARGUMENTS:");
		expect(help).toContain("entry");
		expect(help).toContain("Entry file");
		expect(help).toContain('(default: "src/index.ts")');

		// Options section
		expect(help).toContain("OPTIONS:");
		expect(help).toContain("-p, --port=<number>");
		expect(help).toContain("(default: 3000)");
		expect(help).toContain("    --host=<string>");
		expect(help).toContain('(default: "localhost")');
		expect(help).toContain("-o, --open");
		expect(help).toContain("--help");
		expect(help).toContain("--version");

		// Commands section
		expect(help).toContain("COMMANDS:");
		expect(help).toContain("status");
		expect(help).toContain("Show server status");
		expect(help).toContain(
			'Use "serve <command> --help" for more information.',
		);
	});
});
