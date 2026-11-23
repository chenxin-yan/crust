import { defineCommand } from "@crustjs/core";

import { confirmation } from "./confirmation.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

function _confirmTypesItsContextValue() {
	defineCommand("drop", (cmd) =>
		cmd.use(confirmation).action(async ({ ctx }) => {
			type _Confirm = Expect<
				Equal<Awaited<typeof ctx.confirm>, (message: string) => Promise<void>>
			>;
		}),
	);
}
