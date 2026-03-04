import { helpPlugin, versionPlugin } from "@crustjs/plugins";
import pkg from "../package.json";
import { app } from "./app.ts";
import { greetCmd } from "./commands/greet.ts";

await app
	.use(versionPlugin(pkg.version))
	.use(helpPlugin())
	.command(greetCmd)
	.execute();
