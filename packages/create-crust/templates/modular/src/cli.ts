import { help, version } from "@crustjs/plugins";

import pkg from "../package.json";
import { app } from "./app.ts";
import { greetCmd } from "./commands/greet.ts";

await app.extend(version(pkg.version), help()).command(greetCmd).execute();
