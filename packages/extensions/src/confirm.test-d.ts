import { Crust, defineCommand } from "@crustjs/core";

import { confirm } from "./confirm.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

function _confirmNeedsItsExtension() {
	const drop = defineCommand("drop", (cmd) =>
		cmd.use(confirm).action(async ({ ctx }) => {
			type _Confirm = Expect<
				Equal<Awaited<typeof ctx.confirm>, (message: string) => Promise<void>>
			>;
		}),
	);
	new Crust("app").extend(confirm()).add(drop);
	// @ts-expect-error `.use(confirm)` needs `.extend(confirm())` on the app.
	new Crust("app").add(drop);
}
