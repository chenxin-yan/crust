import { Crust } from "@crustjs/core";
import { z } from "zod";

const User = z.object({ id: z.number(), role: z.enum(["admin", "member"]).default("member") });

const whoami = new Crust("whoami").output(User).action(() => ({ id: 1 }));

const outcome = await whoami.run([]);
if (outcome.status === "completed") {
	const user = outcome.result;
	//    ^?
	console.log(user.role); // "member"
}
