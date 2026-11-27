import { Crust } from "@crustjs/core";
import { prompts } from "@crustjs/prompts/extension";

const create = new Crust("create")
	// [!code highlight]
	.extend(prompts())
	.args({ name: "name", type: "string", required: true, prompt: "Project name" })
	.flags({
		template: {
			type: "string",
			choices: ["vanilla", "vue"],
			default: "vanilla",
			// [!code highlight]
			prompt: "Template",
		},
	})
	.action(({ args, flags, stdout }) => stdout(`created ${args.name} from ${flags.template}`));

await create.execute();
