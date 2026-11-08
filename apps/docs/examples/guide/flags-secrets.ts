import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";

const tokenTip = defineExtension(defineExtensionId("acme:token-tip")).preRun(
	({ sources, stderr }) => {
		if (sources.flags.token === "argv") stderr("Tip: set $ACME_TOKEN instead of passing --token."); // [!code highlight]
	},
);

const deploy = new Crust("deploy")
	.extend(tokenTip)
	.flags({
		token: { type: "string", env: { name: "ACME_TOKEN" }, required: true, sensitive: true },
	})
	.action(({ stdout }) => {
		stdout("deploying");
	});

await deploy.execute();
