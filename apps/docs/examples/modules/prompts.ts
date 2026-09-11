import {
  confirm,
  createPrompts,
  input,
  multiselect,
  select,
  type PromptIO,
  withTerminalIO,
} from "@crustjs/prompts";
import { cyan, magenta } from "@crustjs/style";

//#region builtins
const name = await input({
  message: "Project name?",
  validate(value) {
    if (!value.trim()) throw new Error("Name is required");
  },
});
const runtime = await select({ message: "Runtime?", choices: ["bun", "node", "deno"] });
const features = await multiselect({
  message: "Features?",
  choices: ["lint", "test", "release"],
  required: true,
});
const proceed = await confirm({ message: `Create ${name} for ${runtime}?`, default: true });
console.log({ features, proceed });
//#endregion

//#region io
declare const io: PromptIO;
await withTerminalIO(io, () => input({ message: "Name?" }));
//#endregion

//#region theme
const prompts = createPrompts({ theme: { prefix: magenta, success: cyan } });
await prompts.input({ message: "Name?", initial: "Ada" });
//#endregion
