import { Crust } from "@crustjs/core";

const wait = new Crust("wait")
	// [!code highlight]
	.flags({ seconds: { type: "number", required: true } })
	.action(({ flags, stdout }) => {
		const seconds = flags.seconds;
		//    ^?
		stdout(`waiting ${seconds * 1000}ms`);
	});

await wait.execute();
