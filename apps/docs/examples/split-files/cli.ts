import { runtime } from "@crustjs/core";

import { app } from "./app.ts";
import { greetCommand } from "./commands/greet.ts";

await app.add(runtime([greetCommand])).execute();
