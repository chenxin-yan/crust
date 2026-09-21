export const libraries = [
	{ id: "crust", package: "@crustjs/core", kind: "framework (local)", async: true },
	{ id: "commander", package: "commander", kind: "framework", async: false },
	{ id: "yargs", package: "yargs", kind: "framework", async: false },
	{ id: "clipanion", package: "clipanion", kind: "framework", async: true },
	{ id: "cleye", package: "cleye", kind: "framework", async: true },
	{ id: "argparse", package: "argparse", kind: "command parser", async: false },
	{ id: "stricli", package: "@stricli/core", kind: "framework", async: true },
	{ id: "arg", package: "arg", kind: "parser + routing glue", async: false },
	{ id: "minimist", package: "minimist", kind: "parser + routing glue", async: false },
	{ id: "mri", package: "mri", kind: "parser + routing glue", async: false },
	{ id: "yargs-parser", package: "yargs-parser", kind: "parser + routing glue", async: false },
	{ id: "parse-args", package: "node:util", kind: "runtime builtin + routing glue", async: false },
] as const;
export const exclusions = [
	{
		id: "cmd-ts",
		version: "0.15.0",
		reason:
			"Declarative option defaults/optional types treat explicit empty or missing option values as absent. Cannot meet this fixture's rejection contract without extra token inspection; not a claim about every public composition.",
	},
	{
		id: "gunshi",
		version: "0.37.3",
		reason:
			"Normal entry reserves -v globally; config -v invokes version. Public addGlobalOption refuses replacement. No substitution with gunshi/bone or patch; probe retained.",
	},
	{
		id: "cac",
		version: "7.0.0",
		reason:
			"Numeric-looking strings lose leading zeros before public array transforms. Cannot preserve --region 001 / --tag 002 under this text contract; native probe retained.",
	},
	{
		id: "citty",
		version: "0.2.2",
		reason:
			"Repeated tags are overwritten; strict unknown-option rejection unavailable in this fixture. Reproducible source probe, not blanket runtime incompatibility.",
	},
	{
		id: "sade",
		version: "1.8.1",
		reason:
			"Reserved -v version switch conflicts with config -v value in this chosen contract. Other aliases could work; no monkey patches.",
	},
	{
		id: "oclif",
		version: "5.0.0 (surveyed, not installed)",
		reason:
			"Full framework requires discovery/package assets; official single-file bundling unsupported. Not substituted with parser-only API; no speed claim.",
	},
];
export const targets = ["bun", "node"] as const;
