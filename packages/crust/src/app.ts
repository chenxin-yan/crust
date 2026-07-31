import { Crust } from "@crustjs/core";
import { didYouMean, help, updateNotifier, version } from "@crustjs/extensions";

import pkg from "../package.json";

/**
 * The completed root builder for the `crust` CLI.
 *
 * Command modules derive their child builders from this value with
 * `crustBase.sub(name)` so they inherit the root's flag and Context types;
 * `cli.ts` attaches them and executes.
 */
export const crustBase = new Crust("crust").meta({ description: pkg.description }).extend(
	version(pkg.version),
	updateNotifier({
		currentVersion: pkg.version,
		packageName: pkg.name,
	}),
	didYouMean({ mode: "help" }),
	help(),
);
