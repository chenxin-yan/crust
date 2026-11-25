import { Crust } from "@crustjs/core";

const deploy = new Crust("deploy")
	.flags({
		scope: {
			type: "exclusive",
			required: true,
			flags: {
				"org-id": { type: "string", env: "DEPLOY_ORG_ID" },
				all: { type: "boolean" },
			},
		},
		json: { type: "boolean" },
		jq: { type: "string", requires: ["json"] },
		"kernel-memory": { type: "string", hidden: true, deprecated: "Use --memory instead." },
	})
	.action(({ flags, stdout }) => {
		//         ^?
		const target = flags.scope.flag === "all" ? "every org" : flags.scope.value;
		stdout(`deploying to ${target}`);
	});

await deploy.execute();
