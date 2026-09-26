//#region env-example
import { Crust } from "@crustjs/core";
import { handler, service } from "@crustjs/effect";
import { defineEnv } from "@crustjs/env";
import { Effect } from "effect";

const env = defineEnv("env", {
	PORT: { type: "number", default: 3000 },
	API_TOKEN: { type: "string", required: true },
});

const app = new Crust("app").provide(env()).action(
	handler(function* () {
		const { PORT } = yield* service(env);
		//      ^?
		return PORT;
	}),
);
//#endregion

//#region env-recovery
app.action(
	handler(() =>
		service(env).pipe(
			Effect.map(() => "Environment is valid"),
			Effect.catchTag("CrustEnvError", (error) =>
				Effect.succeed(
					error.details.issues.map((issue) => `${issue.name}: ${issue.received}`).join("\n"),
				),
			),
		),
	),
);
//#endregion

//#region env-testing
new Crust("test").provide(env.of({ PORT: 9000, API_TOKEN: "test" })).action(
	handler(function* () {
		return (yield* service(env)).PORT;
	}),
);
//#endregion
