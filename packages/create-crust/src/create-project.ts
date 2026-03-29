import { runSteps, scaffold } from "@crustjs/create";

export type TemplateStyle = "minimal" | "modular";
export type DistributionMode = "binary" | "runtime";

export interface CreateCrustProjectOptions {
	readonly resolvedDir: string;
	readonly name: string;
	readonly template: TemplateStyle;
	readonly distributionMode: DistributionMode;
	readonly installDeps: boolean;
	readonly initGit: boolean;
}

/**
 * Scaffold project files only (no install or git-init).
 *
 * Safe to run inside a spinner since it produces no console output.
 */
export async function scaffoldCrustProject(
	options: Omit<CreateCrustProjectOptions, "installDeps" | "initGit">,
): Promise<void> {
	const { resolvedDir, name, template, distributionMode } = options;

	const styleTemplatePath =
		template === "minimal" ? "templates/minimal" : "templates/modular";
	const distributionTemplatePath =
		distributionMode === "binary"
			? "templates/distribution/binary"
			: "templates/distribution/runtime";

	await scaffold({
		template: "templates/base",
		dest: resolvedDir,
		context: { name },
		conflict: "overwrite",
	});

	await scaffold({
		template: styleTemplatePath,
		dest: resolvedDir,
		context: { name },
		conflict: "overwrite",
	});

	await scaffold({
		template: distributionTemplatePath,
		dest: resolvedDir,
		context: { name },
		conflict: "overwrite",
	});
}

/**
 * Full project creation: scaffold files, optionally install deps and init git.
 */
export async function createCrustProject(
	options: CreateCrustProjectOptions,
): Promise<void> {
	const { resolvedDir, installDeps, initGit } = options;

	await scaffoldCrustProject(options);

	if (installDeps) {
		await runSteps([{ type: "install" }], resolvedDir);
	}

	if (initGit) {
		await runSteps(
			[{ type: "git-init", commit: "chore: initial commit" }],
			resolvedDir,
		);
	}
}
