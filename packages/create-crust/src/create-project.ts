import type { PostScaffoldStep } from "@crustjs/create";
import { runSteps, scaffold } from "@crustjs/create";

import corePackage from "../../core/package.json";
import crustPackage from "../../crust/package.json";
import extensionsPackage from "../../extensions/package.json";

export type DistributionMode = "binary" | "runtime";

export interface CreateCrustProjectOptions {
	readonly resolvedDir: string;
	readonly name: string;
	readonly distributionMode: DistributionMode;
	readonly installDeps: boolean;
	readonly initGit: boolean;
}

interface CreateCrustProjectDependencies {
	readonly runSteps?: (steps: PostScaffoldStep[], cwd: string) => Promise<void>;
}

const CRUST_TEMPLATE_VERSION_CONTEXT = {
	crustCoreVersion: corePackage.version,
	crustExtensionsVersion: extensionsPackage.version,
	crustCliVersion: crustPackage.version,
} satisfies Record<string, string>;

/**
 * Scaffold project files only (no install or git-init).
 *
 * Safe to run inside a spinner since it produces no console output.
 */
export async function scaffoldCrustProject(
	options: Omit<CreateCrustProjectOptions, "installDeps" | "initGit">,
): Promise<void> {
	const { resolvedDir, name, distributionMode } = options;

	const distributionTemplatePath =
		distributionMode === "binary"
			? "templates/distribution/binary"
			: "templates/distribution/runtime";
	const context = { name, ...CRUST_TEMPLATE_VERSION_CONTEXT };

	await scaffold({
		template: "templates/base",
		dest: resolvedDir,
		context,
	});

	await scaffold({
		template: "templates/minimal",
		dest: resolvedDir,
		context,
		conflict: "overwrite",
	});

	await scaffold({
		template: distributionTemplatePath,
		dest: resolvedDir,
		context,
		conflict: "overwrite",
	});
}

/**
 * Full project creation: scaffold files, optionally install deps and init git.
 */
export async function createCrustProject(
	options: CreateCrustProjectOptions,
	dependencies: CreateCrustProjectDependencies = {},
): Promise<void> {
	const { resolvedDir, installDeps, initGit } = options;
	const runPostScaffoldSteps = dependencies.runSteps ?? runSteps;

	await scaffoldCrustProject(options);

	if (installDeps) {
		await runPostScaffoldSteps([{ type: "install" }], resolvedDir);
	}

	if (initGit) {
		await runPostScaffoldSteps(
			[{ type: "git-init", commit: "chore: initial commit" }],
			resolvedDir,
		);
	}
}
