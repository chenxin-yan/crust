//#region quick-example
import { Crust, CrustError } from "@crustjs/core";
import { defineEnv } from "@crustjs/env";

const env = defineEnv("env", {
	DATABASE_URL: { type: "url", required: true, description: "Postgres connection" },
	PORT: { type: "number", default: 3000 },
	LOG_LEVEL: { type: "string", choices: ["debug", "info", "warn"], default: "info" },
	TAGS: { type: "string", multiple: true, delimiter: "," },
});

const app = new Crust("app").provide(env()).command("serve", (cmd) =>
	cmd.action(async ({ ctx }) => {
		const { DATABASE_URL, PORT } = await ctx.env;
		//      ^?
		console.log(`listening on ${PORT} for ${DATABASE_URL.host}`);
	}),
);
//#endregion

//#region source
const testEnv = defineEnv(
	"env",
	{ PORT: { type: "number", default: 3000 } },
	{ source: { PORT: "8080" } },
);
//#endregion

//#region errors
const outcome = await app.run(["serve"]);
if (outcome.status === "failed" && outcome.error instanceof CrustError && outcome.error.is("ENV")) {
	for (const { name, expected, received } of outcome.error.details.issues) {
		console.error(`${name}: ${received} (expected ${expected})`);
	}
}
//#endregion

void testEnv;
