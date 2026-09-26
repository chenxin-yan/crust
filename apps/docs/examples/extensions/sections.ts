import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";
import { help } from "@crustjs/extensions";

export const guidance = defineExtension(defineExtensionId("acme:guidance")).sections(() => [
	{
		command: [],
		title: "Environment",
		body: "Set DEPLOY_TOKEN before running.",
	},
]);

export const app = new Crust("my-cli").extend(guidance, help()).action(() => {});
