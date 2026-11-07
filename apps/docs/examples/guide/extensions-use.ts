import {
	Crust,
	defineCommand,
	defineContext,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const clock = defineContext("clock").setup(() => ({ now: () => "12:00" }));

export const time = defineExtension(defineExtensionId("acme:time"))
	.provide(clock())
	.factory((extension) => extension);

const now = defineCommand("now", (command) =>
	// [!code highlight]
	command.use(time).action(async ({ ctx, stdout }) => {
		stdout((await ctx.clock).now());
	}),
);

const app = new Crust("my-cli").extend(time()).add(now);

await app.execute();

// Checked but not rendered: the guide states that a missing Extension is a type error.
function unextended() {
	// @ts-expect-error `now` uses `time`, which this app does not extend
	return new Crust("my-cli").add(now);
}
void unextended;
