import { Crust } from "../../../src/index.ts";
import type {
	EffectiveFlags,
	FlagsDef,
	InferFlags,
	ValidateCrossCollisions,
	ValidateFlagAliases,
	ValidateNoPrefixedFlags,
} from "../../../src/index.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const rootFlags = {
	rootFlag00: { type: "boolean", inherit: true, aliases: ["root-flag-00"] },
	rootFlag01: { type: "string", inherit: true, aliases: ["root-flag-01"], default: "one" },
	rootFlag02: { type: "number", inherit: true, aliases: ["root-flag-02"], default: 2 },
	rootFlag03: { type: "boolean", inherit: true, aliases: ["root-flag-03"] },
	rootFlag04: { type: "string", inherit: true, aliases: ["root-flag-04"], required: true },
	rootFlag05: { type: "number", inherit: true, aliases: ["root-flag-05"] },
	rootFlag06: { type: "boolean", inherit: true, aliases: ["root-flag-06"] },
	rootFlag07: { type: "string", inherit: true, aliases: ["root-flag-07"], default: "seven" },
	rootFlag08: { type: "number", inherit: true, aliases: ["root-flag-08"], default: 8 },
	rootFlag09: { type: "boolean", inherit: true, aliases: ["root-flag-09"] },
	rootFlag10: { type: "string", inherit: true, aliases: ["root-flag-10"], required: true },
	rootFlag11: { type: "number", inherit: true, aliases: ["root-flag-11"] },
	rootFlag12: { type: "boolean", inherit: true, aliases: ["root-flag-12"] },
	rootFlag13: { type: "string", inherit: true, aliases: ["root-flag-13"], default: "thirteen" },
	rootFlag14: { type: "number", inherit: true, aliases: ["root-flag-14"], default: 14 },
	rootFlag15: { type: "boolean", inherit: true, aliases: ["root-flag-15"] },
	rootFlag16: { type: "string", inherit: true, aliases: ["root-flag-16"], required: true },
	rootFlag17: { type: "number", inherit: true, aliases: ["root-flag-17"] },
	rootFlag18: { type: "boolean", inherit: true, aliases: ["root-flag-18"] },
	rootFlag19: { type: "string", inherit: true, aliases: ["root-flag-19"], default: "nineteen" },
} satisfies FlagsDef;

const workspaceFlags = {
	workspaceMode: {
		type: "string",
		inherit: true,
		required: true,
		choices: ["fast", "safe", "debug"],
		aliases: ["workspace-mode"],
	},
	workspaceRetries: { type: "number", inherit: true, default: 2, aliases: ["workspace-retries"] },
	workspaceVerbose: { type: "boolean", inherit: true, aliases: ["workspace-verbose"] },
	workspaceTag: { type: "string", inherit: true, multiple: true, aliases: ["workspace-tag"] },
	workspaceJson: { type: "json", inherit: true, aliases: ["workspace-json"] },
} satisfies FlagsDef;

const projectFlags = {
	projectName: { type: "string", inherit: true, required: true, aliases: ["project-name"] },
	projectPort: { type: "number", inherit: true, default: 3000, aliases: ["project-port"] },
	projectDryRun: { type: "boolean", inherit: true, aliases: ["project-dry-run"] },
	projectConfig: { type: "path", inherit: true, aliases: ["project-config"] },
	projectEndpoint: { type: "url", inherit: true, aliases: ["project-endpoint"] },
} satisfies FlagsDef;

type RootFlags = typeof rootFlags;
type WorkspaceFlags = typeof workspaceFlags;
type ProjectFlags = typeof projectFlags;

type CheckedRootFlags = ValidateNoPrefixedFlags<ValidateFlagAliases<RootFlags>>;
type CheckedWorkspaceFlags = ValidateNoPrefixedFlags<
	ValidateCrossCollisions<RootFlags, ValidateFlagAliases<WorkspaceFlags>>
>;
type CheckedProjectFlags = ValidateNoPrefixedFlags<
	ValidateCrossCollisions<
		EffectiveFlags<RootFlags, WorkspaceFlags>,
		ValidateFlagAliases<ProjectFlags>
	>
>;

const checkedRootFlags: CheckedRootFlags = rootFlags;
const checkedWorkspaceFlags: CheckedWorkspaceFlags = workspaceFlags;
const checkedProjectFlags: CheckedProjectFlags = projectFlags;

type WorkspaceEffective = InferFlags<EffectiveFlags<RootFlags, WorkspaceFlags>>;
type ProjectEffective = InferFlags<
	EffectiveFlags<EffectiveFlags<RootFlags, WorkspaceFlags>, ProjectFlags>
>;

type _workspaceRootFlag = Expect<Equal<WorkspaceEffective["rootFlag00"], boolean | undefined>>;
type _workspaceMode = Expect<Equal<WorkspaceEffective["workspaceMode"], string>>;
type _projectName = Expect<Equal<ProjectEffective["projectName"], string>>;
type _projectPort = Expect<Equal<ProjectEffective["projectPort"], number>>;

export const perfApp = new Crust("perf")
	.flags(checkedRootFlags)
	.command("workspace", (workspace) =>
		workspace
			.meta({ aliases: ["ws"], description: "Manage workspaces" })
			.flags(checkedWorkspaceFlags)
			.command("project", (project) =>
				project
					.meta({ aliases: ["proj"], description: "Manage projects" })
					.flags(checkedProjectFlags)
					.command("create", (create) =>
						create
							.meta({ aliases: ["new"], description: "Create a project" })
							.args([
								{ name: "name", type: "string", required: true },
								{ name: "files", type: "path", variadic: true },
							] as const)
							.run(({ args, flags }) => {
								const name: string = args.name;
								const files: string[] = args.files;
								const mode: string = flags.workspaceMode;
								const dryRun: boolean | undefined = flags.projectDryRun;
								const rootDefault: string = flags.rootFlag01;
								void name;
								void files;
								void mode;
								void dryRun;
								void rootDefault;
							}),
					)
					.command("delete", (remove) =>
						remove
							.meta({ aliases: ["rm"], description: "Delete a project" })
							.flags({
								force: { type: "boolean", aliases: ["force-delete"] },
							} satisfies FlagsDef)
							.run(({ flags }) => {
								const force: boolean | undefined = flags.force;
								const endpoint: URL | undefined = flags.projectEndpoint;
								void force;
								void endpoint;
							}),
					),
			)
			.command("doctor", (doctor) =>
				doctor
					.meta({ aliases: ["diagnose"], description: "Inspect workspace health" })
					.run(({ flags }) => {
						const retries: number = flags.workspaceRetries;
						const tags: string[] | undefined = flags.workspaceTag;
						const rootFlag: boolean | undefined = flags.rootFlag18;
						void retries;
						void tags;
						void rootFlag;
					}),
			),
	)
	.command("account", (account) =>
		account
			.meta({ aliases: ["acct"], description: "Manage accounts" })
			.flags({
				accountId: { type: "string", inherit: true, required: true, aliases: ["account-id"] },
				accountRegion: { type: "string", inherit: true, aliases: ["account-region"] },
				accountJson: { type: "json", inherit: true, aliases: ["account-json"] },
			} satisfies FlagsDef)
			.command("login", (login) =>
				login.meta({ aliases: ["signin"], description: "Authenticate" }).run(({ flags }) => {
					const accountId: string = flags.accountId;
					const rootFlag: number = flags.rootFlag14;
					void accountId;
					void rootFlag;
				}),
			),
	);
