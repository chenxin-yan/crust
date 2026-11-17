import { defineCommand } from "@crustjs/core";

import { quiet } from "./quiet.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

function _quietTypesItsContextValue() {
	defineCommand("deploy", (cmd) =>
		cmd.use(quiet).action(async ({ ctx }) => {
			type _Quiet = Expect<Equal<Awaited<typeof ctx.quiet>, boolean>>;
		}),
	);
}

function _quietTakesAnEnvironmentVariableName() {
	quiet();
	quiet({ env: "APP_QUIET" });
	// @ts-expect-error the variable name is a string.
	quiet({ env: true });
}
