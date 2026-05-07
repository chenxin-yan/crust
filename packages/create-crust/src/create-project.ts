import { runSteps, scaffold } from "@crustjs/create";
import corePackage from "../../core/package.json";
import crustPackage from "../../crust/package.json";
import pluginsPackage from "../../plugins/package.json";

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

const CRUST_TEMPLATE_VERSION_CONTEXT = {
	crustCoreVersion: corePackage.version,
	crustPluginsVersion: pluginsPackage.version,
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
	const { resolvedDir, name, template, distributionMode } = options;

	const styleTemplatePath =
		template === "minimal" ? "templates/minimal" : "templates/modular";
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
		template: styleTemplatePath,
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
