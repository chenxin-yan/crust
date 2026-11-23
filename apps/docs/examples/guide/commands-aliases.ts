import { Crust } from "@crustjs/core";

// User-defined aliases, such as ones read from a config file.
const aliases = new Map([["co", ["pr", "checkout"]]]);

/** Replace a first word that is an alias with the words it stands for. */
function expandAliases(argv: string[]): string[] {
	const [first = "", ...rest] = argv;
	const expansion = aliases.get(first);
	return expansion ? [...expansion, ...rest] : argv;
}

const gh = new Crust("gh").command("pr", (pr) =>
	pr.command("checkout", (checkout) =>
		checkout
			.args({ name: "number", type: "number", required: true })
			.action(({ args, stdout }) => stdout(`checking out #${args.number}`)),
	),
);

await gh.execute({ argv: expandAliases(process.argv.slice(2)) });
