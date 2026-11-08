import { Crust } from "@crustjs/core";

const publish = new Crust("publish")
	.flags({
		token: { type: "string", env: { name: "PUBLISH_TOKEN" }, required: true, sensitive: true },
		registry: { type: "string", env: { name: "PUBLISH_REGISTRY" }, default: "npm" },
		tag: {
			type: "string",
			multiple: true,
			delimiter: ",",
			env: { name: "PUBLISH_TAGS", delimiter: ":" },
		},
	})
	.action(({ flags, stdout }) => {
		stdout(`publishing to ${flags.registry} tags=${flags.tag?.join(",") ?? "undefined"}`);
	});

await publish.execute();
