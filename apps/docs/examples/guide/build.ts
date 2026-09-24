//#region runtime-secret
// @types: node
import { Crust } from "@crustjs/core";

const cli = new Crust("my-cli").action(({ stdout }) => {
	// [!code highlight]
	const token = process.env.API_TOKEN;
	//    ^?
	if (!token) throw new Error("Missing API_TOKEN");
	stdout("Deploying");
});
//#endregion

//#region build-constant
const app = cli.command("origin", (command) =>
	command.action(({ stdout }) => {
		// [!code highlight]
		stdout(process.env.PUBLIC_API_ORIGIN ?? "No public origin configured");
	}),
);

await app.execute();
//#endregion
