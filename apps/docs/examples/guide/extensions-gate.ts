import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";
import { help } from "@crustjs/extensions";

const signedIn = false;

const requireLogin = defineExtension(defineExtensionId("acme:require-login")).preRun(
	({ command }) => {
		if (command.extension === "crust:help") return; // [!code highlight]
		if (!signedIn) throw new Error("Not signed in: run `app login`");
	},
);

const app = new Crust("app")
	.extend(help({ command: true }), requireLogin)
	.command("deploy", (deploy) => deploy.action(() => {}));

console.log((await app.run(["help"], { args: { command: ["deploy"] } })).status); // => "completed"
console.log((await app.run(["deploy"])).status); // => "failed"
