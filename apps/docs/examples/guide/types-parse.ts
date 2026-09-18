import { Crust } from "@crustjs/core";

const deploy = new Crust("deploy")
	.flags({ name: "regions", type: "string", parse: (raw) => raw.split(",") })
	.action(({ flags, stdout }) => {
		const regions = flags.regions; // string[] | undefined
		stdout(`deploying to ${regions?.join(" and ") ?? "the default region"}`);
	});

await deploy.execute();
