import { Crust, type RootCommandMeta } from "@crustjs/core";

import { updateNotifier } from "./update-notifier.ts";

function _updateNotifierVersionRequirements() {
	// @ts-expect-error updateNotifier() without currentVersion needs a guaranteed root version.
	new Crust("app").extend(updateNotifier({ packageName: "app" }));
	new Crust("app", { version: "1" }).extend(updateNotifier({ packageName: "app" }));
	new Crust("app").extend(updateNotifier({ packageName: "app", currentVersion: "1" }));
	const maybe = Math.random() ? "1" : undefined;
	// @ts-expect-error Optional overrides conservatively need root metadata.
	new Crust("app").extend(updateNotifier({ packageName: "app", currentVersion: maybe }));
	new Crust("app", { version: "1" }).extend(
		updateNotifier({ packageName: "app", currentVersion: maybe }),
	);
	// @ts-expect-error A root version that may be undefined is not guaranteed.
	new Crust("app", { version: maybe }).extend(updateNotifier({ packageName: "app" }));
}

function _updateNotifierRequiresGuaranteedRootMeta(meta: RootCommandMeta) {
	// @ts-expect-error Optional root metadata does not guarantee a version.
	new Crust("app", meta).extend(updateNotifier({ packageName: "app" }));
}
