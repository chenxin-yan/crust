import type { CrustPlugin } from "@crustjs/core";

export type VersionValue = string | (() => string);

export function versionPlugin(
	versionValue: VersionValue = "0.0.0",
): CrustPlugin {
	return {
		name: "version",
		setup(context, actions) {
			actions.addFlag(context.rootCommand, "version", {
				type: Boolean,
				alias: "v",
				description: "Show version number",
			});
		},
		async middleware(context, next) {
			if (!context.route || context.route.command !== context.rootCommand) {
				await next();
				return;
			}

			if (!context.input?.flags.version) {
				await next();
				return;
			}

			const version =
				typeof versionValue === "function" ? versionValue() : versionValue;

			console.log(`${context.rootCommand.meta.name} v${version}`);
		},
	};
}
