import { Crust } from "@crustjs/core";

const copy = new Crust("copy")
	.args(
		{ name: "destination", type: "path", required: true },
		// [!code highlight]
		{ name: "files", type: "path", variadic: true },
	)
	.action(({ args, stdout }) => {
		const files = args.files;
		//    ^?
		stdout(`${files.length} files to ${args.destination}`);
	});

await copy.execute();
