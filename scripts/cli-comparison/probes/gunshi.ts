import { cli, define } from "gunshi";

await cli(["config", "theme", "-v", "dark"], define({ name: "cli" }), {
	name: "cli",
	renderHeader: null,
	strict: true,
	subCommands: {
		config: define({
			name: "config",
			args: { key: { type: "positional", required: true }, value: { type: "string", short: "v" } },
			run: ({ values }) => {
				console.log(JSON.stringify({ command: "config", key: values.key, value: values.value }));
			},
		}),
	},
});
