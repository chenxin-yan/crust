import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { defineCommand } from "@crustjs/core";

/**
 * Resolve the output file path for the compiled binary.
 *
 * Priority: --outfile > --name (as ./dist/<name>) > package.json name > entry filename
 *
 * @param outfile - Explicit output file path from --outfile flag
 * @param name - Binary name from --name flag
 * @param entry - Resolved entry file path
 * @param cwd - Current working directory
 * @returns The resolved output file path
 */
export function resolveOutfile(
	outfile: string | undefined,
	name: string | undefined,
	entry: string,
	cwd: string,
): string {
	// 1. Explicit --outfile takes highest priority
	if (outfile) {
		return resolve(cwd, outfile);
	}

	// 2. --name flag: output as ./dist/<name>
	if (name) {
		return resolve(cwd, "dist", name);
	}

	// 3. Try reading name from package.json in cwd
	const pkgPath = join(cwd, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkgJson = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
				name?: string;
			};
			if (pkgJson?.name && typeof pkgJson.name === "string") {
				// Strip scope prefix (e.g. @scope/name → name)
				const pkgName = pkgJson.name.replace(/^@[^/]+\//, "");
				return resolve(cwd, "dist", pkgName);
			}
		} catch {
			// Ignore parse errors, fall through to entry filename
		}
	}

	// 4. Derive from entry filename (strip extension)
	const entryBase = basename(entry).replace(/\.[^.]+$/, "");
	return resolve(cwd, "dist", entryBase);
}

/**
 * The `crust build` command.
 *
 * Compiles a CLI entry file to a standalone Bun executable using `bun build --compile`.
 *
 * @example
 * ```sh
 * crust build                          # Build src/cli.ts → dist/<pkg-name>
 * crust build --entry src/main.ts      # Custom entry point
 * crust build --outfile ./my-cli       # Custom output path
 * crust build --name my-tool           # Output as dist/my-tool
 * crust build --no-minify              # Disable minification
 * ```
 */
export const buildCommand = defineCommand({
	meta: {
		name: "build",
		description: "Compile your CLI to a standalone executable",
	},
	flags: {
		entry: {
			type: String,
			description: "Entry file path",
			default: "src/cli.ts",
			alias: "e",
		},
		outfile: {
			type: String,
			description: "Output file path",
			alias: "o",
		},
		name: {
			type: String,
			description:
				"Binary name (defaults to package.json name or entry filename)",
			alias: "n",
		},
		minify: {
			type: Boolean,
			description: "Minify the output",
			default: true,
		},
	},
	async run({ flags }) {
		const cwd = process.cwd();

		// Resolve entry file path relative to cwd
		const entryPath = resolve(cwd, flags.entry);

		// Verify entry file exists
		if (!existsSync(entryPath)) {
			throw new Error(
				`Entry file not found: ${entryPath}\n  Specify a valid entry file with --entry <path>`,
			);
		}

		// Determine output path
		const outfilePath = resolveOutfile(
			flags.outfile,
			flags.name,
			entryPath,
			cwd,
		);

		// Build the bun build --compile args
		const args: string[] = [
			"build",
			"--compile",
			entryPath,
			"--outfile",
			outfilePath,
		];

		if (flags.minify) {
			args.push("--minify");
		}

		console.log(`Building ${entryPath} → ${outfilePath}...`);

		// Shell out to bun build --compile
		const proc = Bun.spawn(["bun", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});

		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			const stderr = await new Response(proc.stderr).text();
			throw new Error(
				`Build failed with exit code ${exitCode}${stderr ? `:\n${stderr.trim()}` : ""}`,
			);
		}

		console.log(`Built successfully: ${outfilePath}`);
	},
});
