import { Crust } from "@crustjs/core";
import { didYouMean, help, updateNotifier, version } from "@crustjs/extensions";

// Named imports, so the build embeds these fields and not the whole package.json.
import { description, name, version as currentVersion } from "../package.json";

/** The completed root builder and Extensions for the `crust` CLI. */
export const crustBase = new Crust("crust", { description }).extend(
	version(currentVersion),
	updateNotifier({ currentVersion, packageName: name }),
	didYouMean({ mode: "help" }),
	help(),
);
