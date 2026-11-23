import { Crust, type RootCommandMeta } from "@crustjs/core";

import { help } from "./help.ts";
import { version } from "./version.ts";

function _versionRequirements() {
	// @ts-expect-error version() needs a guaranteed root version.
	new Crust("app").extend(version());
	new Crust("app", { version: "1" }).extend(help(), version());
	new Crust("app").extend(version("1"));
	const maybe = Math.random() ? "1" : undefined;
	// @ts-expect-error Optional overrides conservatively need root metadata.
	new Crust("app").extend(version(maybe));
	new Crust("app", { version: "1" }).extend(version(maybe));
	// @ts-expect-error A root version that may be undefined is not guaranteed.
	new Crust("app", { version: maybe }).extend(version());
}

function _versionRequiresGuaranteedRootMeta(meta: RootCommandMeta) {
	// @ts-expect-error Optional root metadata does not guarantee a version.
	new Crust("app", meta).extend(version());
}

function _versionShortSpellings() {
	version("1", { short: "V" });
	version("1", { short: false });
	// @ts-expect-error `-v` and `-V` are the conventional version shorts; any other letter is a mistake.
	version("1", { short: "x" });
}
