import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { Crust } from "../command/crust.ts";

declare function port(): StandardSchema<string | undefined, number>;

// Compile-time regression checks; intentionally never invoked.
// the schema output type reaches the Command Action
function _typecheckTheSchemaOutputTypeReachesTheCommandAction() {
	new Crust("cli")
		.args({ name: "port", schema: port() })
		.flags({ name: "tag", type: "string", schema: port() })
		.action((_ctx) => {
			type _argOutput = Expect<Equal<(typeof _ctx.args)["port"], number>>;
			type _flagOutput = Expect<Equal<(typeof _ctx.flags)["tag"], number>>;
		});
}
