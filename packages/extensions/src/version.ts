import { type Extension, defineExtension } from "@crustjs/core";

export type VersionValue = string | (() => string);

export function versionExtension(versionValue: VersionValue = "0.0.0"): Extension {
	return defineExtension("version", {
		flags: {
			version: {
				type: "boolean",
				short: "v",
				noNegate: true,
				description: "Show version number",
				recursive: false,
			},
		},
		hooks: {
			preRun(context) {
				// Root invocation with --version only
				if (context.commandPath.length !== 1 || context.flags.version !== true) return;

				const version = typeof versionValue === "function" ? versionValue() : versionValue;
				context.stdout(`${context.rootCommand.meta.name} v${version}`);
				return context.finish();
			},
		},
	});
}
