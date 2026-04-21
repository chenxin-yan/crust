import { type PostScaffoldStep, runSteps, scaffold } from "@crustjs/create";

export type TemplateStyle = "minimal" | "modular";
export type DistributionMode = "binary" | "runtime";

/**
 * Per-distribution-mode lists of `@crustjs/*` packages to resolve + pin at
 * scaffold time. Kept as bare names — the `add` post-scaffold step appends
 * `@latest` and lets the package manager write a caret range into the
 * consumer's `package.json`.
 */
const CRUST_DEPS_BY_MODE: Record<
	DistributionMode,
	{
		readonly dependencies: readonly string[];
		readonly devDependencies: readonly string[];
	}
> = {
	runtime: {
		dependencies: ["@crustjs/core", "@crustjs/plugins"],
		devDependencies: ["@crustjs/crust", "@types/bun"],
	},
	binary: {
		dependencies: [],
		devDependencies: [
			"@crustjs/core",
			"@crustjs/crust",
			"@crustjs/plugins",
			"@types/bun",
		],
	},
};

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
 * Full project creation: scaffold files, optionally add + install deps and
 * init git.
 *
 * When `installDeps` is `true`, the `@crustjs/*` packages for the chosen
 * distribution mode are added via the detected package manager's `add`
 * command so the user's `package.json` ends up with resolved caret ranges
 * (e.g. `^1.2.3`) rather than the literal `"latest"` tag. This single step
 * both writes the dependency entries and performs the install.
 *
 * When `installDeps` is `false`, no crust packages are added and no
 * install runs — the consumer will need to add them manually later.
 */
export async function createCrustProject(
	options: CreateCrustProjectOptions,
): Promise<void> {
	const { resolvedDir, distributionMode, installDeps, initGit } = options;

	await scaffoldCrustProject(options);

	const steps: PostScaffoldStep[] = [];

	if (installDeps) {
		const { dependencies, devDependencies } =
			CRUST_DEPS_BY_MODE[distributionMode];
		steps.push({ type: "add", dependencies, devDependencies });
	}

	if (initGit) {
		steps.push({ type: "git-init", commit: "chore: initial commit" });
	}

	if (steps.length > 0) {
		await runSteps(steps, resolvedDir);
	}
}
