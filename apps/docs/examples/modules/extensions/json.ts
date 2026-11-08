import { Crust } from "@crustjs/core";
import { json } from "@crustjs/extensions";

const app = new Crust("my-cli").extend(json()).command("deploy", (cmd) =>
	cmd.action(({ stdout }) => {
		stdout("Deploying...");
		return { id: "dep_42", url: "https://example.com" };
	}),
);

await app.execute();
