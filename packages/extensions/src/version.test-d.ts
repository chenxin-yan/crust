import { Crust } from "@crustjs/core";

import { help } from "./help.ts";
import { version } from "./version.ts";

function _versionRequirements() {
	// @ts-expect-error version() needs a guaranteed root version.
	new Crust("app").extend(version());
	new Crust("app", { version: "1" }).extend(help(), version());
	new Crust("app").extend(version("1"));
	new Crust("app").extend(version(() => "1"));
	// @ts-expect-error An explicit undefined still needs root metadata.
	new Crust("app").extend(version(undefined, { format: "plain" }));
	const maybe = Math.random() ? "1" : undefined;
	// @ts-expect-error Optional overrides conservatively need root metadata.
	new Crust("app").extend(version(maybe));
	new Crust("app", { version: "1" }).extend(version(maybe));
	// @ts-expect-error Lazy providers must return a definite string.
	version(() => maybe);
	new Crust("app", { version: "1" })
		.flags({ name: "shout", type: "boolean" })
		.args({ name: "name", type: "string", default: "world" })
		.action(({ args }) => args.name)
		.extend(version());
}
