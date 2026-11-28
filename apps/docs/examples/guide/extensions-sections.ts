import { Crust, defineExtension } from "@crustjs/core";
import { help } from "@crustjs/extensions";

export const guidance = defineExtension("acme:guidance").sections(() => [
	{
		command: [], // [!code highlight]
		title: "Environment",
		body: "Set DEPLOY_TOKEN before running.",
	},
]);

const app = new Crust("my-cli").extend(guidance, help()).action(() => {});
await app.execute();
