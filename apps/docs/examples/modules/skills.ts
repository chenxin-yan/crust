import { Crust, defineCommand } from "@crustjs/core";
import { skill, writeSkills } from "@crustjs/skills";

const deploy = defineCommand("deploy", { description: "Deploy the app" }, (command) =>
  command.action(() => {}),
);

//#region extension
export const app = new Crust("my-cli", { description: "Manage deployments", version: "1.2.3" })
  .add(deploy)
  .extend(skill({ distDir: new URL("../dist/skills", import.meta.url) }));
//#endregion

//#region write
const files = await writeSkills({ app, outDir: "dist/skills", version: "1.2.3" });
console.log(files); // ["my-cli/SKILL.md", "my-cli/commands/my-cli.md", "my-cli/commands/deploy.md"]
//#endregion
