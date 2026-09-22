//#region extension
import { Crust, defineCommand } from "@crustjs/core";
import { skill } from "@crustjs/skills";

const deploy = defineCommand("deploy", { description: "Deploy the app" }, (command) =>
	command.action(() => {}),
);

export const app = new Crust("my-cli", { description: "Manage deployments", version: "1.2.3" })
	.add(deploy)
	.extend(skill({}));
//#endregion

//#region write
import { Crust as WriteCrust, defineCommand as defineWriteCommand } from "@crustjs/core";
import { skill as writeSkill, writeSkills } from "@crustjs/skills";

const writeApp = new WriteCrust("my-cli", {
	description: "Manage deployments",
	version: "1.2.3",
})
	.add(
		defineWriteCommand("deploy", { description: "Deploy the app" }, (command) =>
			command.action(() => {}),
		),
	)
	.extend(writeSkill({}));
const files = await writeSkills({
	app: writeApp,
	outDir: ".crust/artifacts/skills",
	version: "1.2.3",
});
console.log(files);
// ["my-cli/SKILL.md", "my-cli/commands/my-cli.md", "my-cli/commands/deploy.md",
//  "my-cli/commands/skills.md", "my-cli/commands/skills/install.md",
//  "my-cli/commands/skills/repair.md", "my-cli/commands/skills/uninstall.md"]
//#endregion

//#region sections
import { defineCommand as defineSectionCommand } from "@crustjs/core";
import { skill as sectionSkill } from "@crustjs/skills";

export const documentedDeploy = defineSectionCommand(
	"deploy",
	{
		sections: [
			{ title: "Safety", body: "Run preview first." },
			{
				title: "Agent procedure",
				body: "Inspect preview output.",
				only: [sectionSkill],
			},
		],
	},
	(command) => command.action(() => {}),
);
//#endregion
