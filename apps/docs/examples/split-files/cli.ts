import { app } from "./app.ts";
import { greetCommand } from "./commands/greet.ts";

// [!code highlight]
await app.add(greetCommand).execute();
