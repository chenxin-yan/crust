import { Crust } from "@crustjs/core";
import { config } from "@crustjs/extensions";

const app = new Crust("acme")
	.extend(config({ name: "acme", project: "acme.config.json", user: true }))
	.flags({
		org: { type: "string", env: { name: "ACME_ORG" }, config: "org", required: true },
		region: { type: "string", choices: ["us", "eu"], config: "region", default: "us" },
	})
	.action(({ flags, stdout }) => {
		stdout(`org=${flags.org} region=${flags.region}`);
	});

await app.execute();
