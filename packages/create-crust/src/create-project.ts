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

export async function createCrustProject(
	options: CreateCrustProjectOptions,
): Promise<void> {
	const {
		resolvedDir,
		name,
		template,
		distributionMode,
		installDeps,
		initGit,
	} = options;

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
