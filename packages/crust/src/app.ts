import { Crust } from "@crustjs/core";
import { didYouMean, help, updateNotifier, version } from "@crustjs/extensions";

import pkg from "../package.json";

/** The completed root builder and Extensions for the `crust` CLI. */
export const crustBase = new Crust("crust").meta({ description: pkg.description }).extend(
	version(pkg.version),
	updateNotifier({
		currentVersion: pkg.version,
		packageName: pkg.name,
	}),
	didYouMean({ mode: "help" }),
	help(),
);
