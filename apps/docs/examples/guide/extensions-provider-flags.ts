import {
	Crust,
	defineCommand,
	defineContext,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

//#region use-site
const confirm = defineContext("confirm")
	.flags({ yes: { type: "boolean", description: "Skip the confirmation" } })
	.setup(({ flags }) => ({ skip: flags.yes === true }));

const confirmation = defineExtension(defineExtensionId("acme:confirmation")).provide(confirm());

const remove = defineCommand("remove", (command) =>
	command
		.use(confirm) // [!code highlight]
		.action(async ({ ctx, stdout }) => {
			stdout((await ctx.confirm).skip ? "removed" : "pass --yes to remove");
		}),
);
const list = defineCommand("list", (command) => command.action(({ stdout }) => stdout("a b")));

const app = new Crust("my-cli").extend(confirmation).add(remove, list);
//#endregion

//#region hooks
export const audited = confirmation
	.use(confirm) // [!code highlight]
	.postRun(async ({ ctx, stderr }) => {
		if ((await ctx.confirm).skip) stderr("confirmation skipped with --yes");
	});
//#endregion

await app.execute();
