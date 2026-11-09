import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";

import { help } from "./help.ts";
import { json } from "./json.ts";

function _jsonIsTheOnlyRenderer() {
	const quiet = defineExtension(defineExtensionId("test:quiet")).renderer((ctx) => ({
		text: ctx.stdout,
		diag: ctx.stderr,
	}));
	new Crust("app").extend(help(), json());
	// @ts-expect-error Only one Extension in an application can set a renderer.
	new Crust("app").extend(help(), json(), quiet);
}
