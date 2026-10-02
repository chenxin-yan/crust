import { resolve } from "node:path";

import { defineCommand } from "@crustjs/core";

import { CRUST_DIR } from "../distribute.ts";
import { publishStagedPackages, readPublishManifest } from "../publish.ts";

export const publishCommand = defineCommand(
	"publish",
	{ description: "Publish the npm packages staged in .crust/ by crust build" },
	(command) =>
		command
			.flags(
				{
					name: "tag",
					type: "string",
					description: "Override the npm dist-tag passed to npm publish",
				},
				{
					name: "dry-run",
					type: "boolean",
					description: "Print publish order and commands without publishing",
					default: false,
				},
				{
					name: "registry",
					type: "string",
					description: "Override the registry passed to npm publish",
				},
			)
			.action(async ({ flags, stdout, stderr }) => {
				const cwd = process.cwd();
				const stageDir = resolve(cwd, CRUST_DIR);
				const manifest = readPublishManifest(stageDir);

				await publishStagedPackages(
					manifest,
					{
						stageDir,
						tag: flags.tag,
						registry: flags.registry,
						dryRun: flags["dry-run"],
					},
					{ stdout, stderr },
				);
			}),
);
