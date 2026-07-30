import { type Extension, extension } from "@crustjs/core";

export type VersionValue = string | (() => string);

export function versionExtension(versionValue: VersionValue = "0.0.0"): Extension {
	return extension("version", {
		flags: {
			version: {
				type: "boolean",
				short: "v",
				noNegate: true,
				description: "Show version number",
				recursive: false,
			},
		},
		async intercept(context, next) {
			// Root invocation with --version only
			if (context.commandPath.length !== 1 || context.flags.version !== true) {
				await next();
				return;
			}

			const version = typeof versionValue === "function" ? versionValue() : versionValue;
			context.stdout(`${context.rootCommand.meta.name} v${version}`);
		},
	});
}
