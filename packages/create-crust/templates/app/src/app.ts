import { Crust } from "@crustjs/core";
import { completion, didYouMean, help, noColor, version } from "@crustjs/extensions";
// import { updateNotifier } from "@crustjs/extensions";

import pkg from "../package.json";
import { todoStore } from "./shared.ts";

export const app = new Crust("{{name}}", { description: "A todo CLI built with Crust" })
	.extend(
		version(pkg.version),
		help(),
		noColor(),
		didYouMean(),
		completion({ binName: pkg.name, version: pkg.version }),
		// Enable after first publish; needs a cache adapter to avoid a registry request per run.
		// updateNotifier({ packageName: pkg.name, currentVersion: pkg.version }),
	)
	.provide(todoStore());
