import type { Equal, Expect } from "../tests/helpers.ts";
import { defineExtension } from "./api/extension.ts";
import { Crust, defineCommand } from "./command/crust.ts";
import { sectionsFor, visibleSectionsFor } from "./sections.ts";

// An Extension names itself as the consumer inside its own hook, with no separate id variable.
const webDocs = defineExtension("acme:web-docs").build(({ snapshot }) => {
	const lines = visibleSectionsFor(snapshot, webDocs).flatMap(({ path, sections }) => [
		`# ${[snapshot.meta.name, ...path].join(" ")}`,
		...sections.map((s) => `## ${s.title}\n${s.body}`),
	]);
	return [{ path: "web-docs/docs.md", content: lines.join("\n\n") }];
});
type _id = Expect<Equal<typeof webDocs.id, "acme:web-docs">>;

const deploy = defineCommand(
	"deploy",
	{ sections: [{ title: "Screenshots", body: "![preview](preview.png)", only: [webDocs] }] },
	(command) => command.action(() => {}),
);
void new Crust("my-cli").add(deploy).extend(webDocs);

// An id string is a consumer too; any other value is not.
sectionsFor(undefined, "acme:web-docs");
// @ts-expect-error -- a consumer is an Extension or its id
sectionsFor(undefined, 42);
