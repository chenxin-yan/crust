#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { runSteps, scaffold } from "@crustjs/create";

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

		// Scaffold the project using @crustjs/create
		await scaffold({
			template: "../templates/base",
			dest: resolvedDir,
			importMeta: import.meta.url,
			context: { name, description, author },
			conflict: "overwrite",
		});

		// Run post-scaffold steps
		console.log("\nInstalling dependencies...\n");
		await runSteps([{ type: "install" }], resolvedDir);

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
