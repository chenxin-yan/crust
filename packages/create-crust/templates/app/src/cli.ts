import { app } from "./app.ts";
import { addCommand } from "./commands/add.ts";
import { doneCommand } from "./commands/done.ts";
import { listCommand } from "./commands/list.ts";
import { removeCommand } from "./commands/remove.ts";

await app.add(addCommand, listCommand, doneCommand, removeCommand).execute();
