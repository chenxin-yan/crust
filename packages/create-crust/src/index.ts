#!/usr/bin/env bun

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

// ────────────────────────────────────────────────────────────────────────────
// Template generators — embedded as functions to avoid disk I/O issues
// ────────────────────────────────────────────────────────────────────────────

function templatePackageJson(
	name: string,
	description: string,
	author: string,
): string {
	const pkg: Record<string, unknown> = {
		name,
		version: "0.0.0",
		type: "module",
		bin: {
			[name]: "dist/cli.js",
		},
		scripts: {
			build: "crust build",
			dev: "crust dev",
		},
		dependencies: {
			crust: "latest",
		},
		devDependencies: {
			typescript: "^5",
		},
	};

	if (description) {
		pkg.description = description;
	}
	if (author) {
		pkg.author = author;
	}

	return JSON.stringify(pkg, null, 2);
}

function templateTsconfig(): string {
	return JSON.stringify(
		{
			compilerOptions: {
				lib: ["ESNext"],
				target: "ESNext",
				module: "Preserve",
				moduleDetection: "force",
				moduleResolution: "bundler",
				allowImportingTsExtensions: true,
				verbatimModuleSyntax: true,
				noEmit: true,
				strict: true,
				skipLibCheck: true,
				noFallthroughCasesInSwitch: true,
				noUncheckedIndexedAccess: true,
			},
			include: ["src"],
		},
		null,
		2,
	);
}

function templateCliTs(name: string): string {
	return `#!/usr/bin/env bun

import { defineCommand, helpPlugin, runMain, versionPlugin } from "crust";

const main = defineCommand({
\tmeta: {
\t\tname: "${name}",
\t\tdescription: "A CLI built with Crust",
\t},
\targs: [
\t\t{
\t\t\tname: "name",
\t\t\ttype: String,
\t\t\tdescription: "Your name",
\t\t\tdefault: "world",
\t\t},
\t],
\tflags: {
\t\tgreet: {
\t\t\ttype: String,
\t\t\tdescription: "Greeting to use",
\t\t\tdefault: "Hello",
\t\t\talias: "g",
\t\t},
\t},
\trun({ args, flags }) {
\t\tconsole.log(\`\${flags.greet}, \${args.name}!\`);
\t},
});

runMain(main, {
	plugins: [versionPlugin("0.0.0"), helpPlugin()],
});
`;
}

function templateIndexTs(): string {
	return `export * from "./cli.ts";
`;
}

// ────────────────────────────────────────────────────────────────────────────
// Interactive prompts (readline-based, zero dependencies)
// ────────────────────────────────────────────────────────────────────────────

async function prompt(
	rl: ReturnType<typeof createInterface>,
	question: string,
	defaultValue: string,
): Promise<string> {
	const suffix = defaultValue ? ` (${defaultValue})` : "";
	const answer = await rl.question(`${question}${suffix}: `);
	return answer.trim() || defaultValue;
}

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

const INVALID_NAME_CHARS = /[<>:"|?*\\]/;

function validateProjectName(name: string): string | null {
	if (!name) {
		return "Project name cannot be empty";
	}
	if (INVALID_NAME_CHARS.test(name)) {
		return `Project name contains invalid characters: ${name}`;
	}
	return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Scaffold logic
// ────────────────────────────────────────────────────────────────────────────

export interface ScaffoldOptions {
	dir: string;
	name: string;
	description: string;
	author: string;
}

export function scaffold(options: ScaffoldOptions): void {
	const { dir, name, description, author } = options;

	// Create directories
	mkdirSync(resolve(dir, "src"), { recursive: true });

	// Write files
	writeFileSync(
		resolve(dir, "package.json"),
		`${templatePackageJson(name, description, author)}\n`,
	);
	writeFileSync(resolve(dir, "tsconfig.json"), `${templateTsconfig()}\n`);
	writeFileSync(resolve(dir, "src", "cli.ts"), templateCliTs(name));
	writeFileSync(resolve(dir, "src", "index.ts"), templateIndexTs());
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────────────

export async function main(
	argv: string[] = process.argv.slice(2),
): Promise<void> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		// Determine project directory from positional arg or prompt
		let targetDir = argv[0];
		if (!targetDir) {
			targetDir = await prompt(rl, "Project directory", "my-cli");
		}

		const resolvedDir = resolve(process.cwd(), targetDir);
		const dirName = basename(resolvedDir);

		// Check if directory already exists and is non-empty
		if (existsSync(resolvedDir)) {
			const answer = await prompt(
				rl,
				`Directory "${dirName}" already exists. Overwrite?`,
				"no",
			);
			if (answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "y") {
				console.log("Aborted.");
				return;
			}
		}

		// Prompt for project details
		const name = await prompt(rl, "Project name", dirName);
		const nameError = validateProjectName(name);
		if (nameError) {
			throw new Error(nameError);
		}

		const description = await prompt(
			rl,
			"Description",
			"A CLI built with Crust",
		);
		const author = await prompt(rl, "Author", "");

		// Scaffold the project
		scaffold({ dir: resolvedDir, name, description, author });

		// Run bun install
		console.log("\nInstalling dependencies...\n");
		const install = Bun.spawn(["bun", "install"], {
			cwd: resolvedDir,
			stdout: "inherit",
			stderr: "inherit",
		});
		await install.exited;

		// Print success message
		const relativeDir = targetDir.startsWith("/")
			? targetDir
			: `./${targetDir}`;
		console.log(`\nCreated ${name}!\n`);
		console.log("Next steps:");
		console.log(`  cd ${relativeDir}`);
		console.log("  bun run dev");
		console.log("  bun run build");
	} finally {
		rl.close();
	}
}

// Only run main() when executed directly, not when imported
const isMainModule =
	process.argv[1] === import.meta.filename ||
	process.argv[1]?.endsWith("/create-crust/dist/index.js") ||
	process.argv[1]?.endsWith("/create-crust/src/index.ts");

if (isMainModule) {
	main();
}
