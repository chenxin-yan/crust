import { Crust } from "@crustjs/core";

const publish = new Crust("publish")
	.flags({
		token: { type: "string", env: "PUBLISH_TOKEN", required: true },
		registry: {
			type: "string",
			env: ["PUBLISH_REGISTRY", "npm_config_registry"],
			default: "npm",
		},
		tag: { type: "string", multiple: true, delimiter: ",", env: "PUBLISH_TAGS" },
	})
	.action(({ flags, stdout }) => {
		stdout(`publishing to ${flags.registry} tags=${flags.tag?.join(",") ?? "undefined"}`);
	});

await publish.execute();
