import { app } from "./app.ts";
import { greetCommand } from "./commands/greet.ts";

await app.add(greetCommand).execute();
