import { Crust, defineCommand, defineExtension, defineExtensionId } from "@crustjs/core";
import { visibleSectionsFor } from "@crustjs/core/tooling";

const WEB_DOCS = defineExtensionId("acme:web-docs");

export const webDocs = defineExtension(WEB_DOCS, {
	build({ snapshot }) {
		// [!code highlight]
		const lines = visibleSectionsFor(snapshot, WEB_DOCS).flatMap(({ path, sections }) => [
			//                                                             ^?
			//                                                                   ^?
			`# ${[snapshot.meta.name, ...path].join(" ")}`,
			...sections.map((s) => `## ${s.title}\n${s.body}`),
		]);
		return [{ path: "web-docs/docs.md", content: lines.join("\n\n") }];
	},
});

const deploy = defineCommand(
	"deploy",
	{
		sections: [
			{ title: "Safety", body: "Run preview first." },
			// [!code highlight]
			{ title: "Screenshots", body: "![preview](preview.png)", only: [webDocs] },
		],
	},
	(command) => command.action(() => {}),
);

export const app = new Crust("my-cli").add(deploy).extend(webDocs);
