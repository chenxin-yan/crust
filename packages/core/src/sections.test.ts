import { describe, expect, it } from "vite-plus/test";

import { definingOf } from "./api/context.ts";
import { defineExtension } from "./api/extension.ts";
import { defineCommand, Crust } from "./command/crust.ts";
import { sectionsFor, visibleSectionsFor } from "./sections.ts";

const agentDocs = "agent-docs";
const terminal = "terminal";

describe("sectionsFor", () => {
	it("includes only sections addressed to the requested consumer", () => {
		const section = { title: "Agent notes", body: "For agents", only: [agentDocs] } as const;
		expect(sectionsFor([section], agentDocs)).toEqual([section]);
		expect(sectionsFor([section], terminal)).toEqual([]);
	});

	it("excludes sections from an excepted consumer", () => {
		const section = { title: "Human notes", body: "For humans", except: [agentDocs] } as const;
		expect(sectionsFor([section], terminal)).toEqual([section]);
		expect(sectionsFor([section], agentDocs)).toEqual([]);
	});

	it("accepts an Extension as the consumer", () => {
		const docs = defineExtension(agentDocs);
		const section = { title: "Agent notes", body: "For agents", only: [agentDocs] } as const;
		expect(sectionsFor([section], docs)).toEqual([section]);
		expect(sectionsFor([section], defineExtension(terminal))).toEqual([]);
	});

	it("merges same-title sections at their first position with a single newline", () => {
		expect(
			sectionsFor(
				[
					{ title: "Examples", body: "First example" },
					{ title: "Notes", body: "A note" },
					{ title: "Examples", body: "Second example" },
				],
				terminal,
			),
		).toEqual([
			{ title: "Examples", body: "First example\nSecond example" },
			{ title: "Notes", body: "A note" },
		]);
	});
});

describe("visibleSectionsFor", () => {
	it("collects audience-visible sections in canonical path order and skips hidden trees", async () => {
		const section = <const T extends string>(title: T) =>
			({ title, body: `${title} body` }) as const;
		const app = new Crust("demo", {
			sections: [section("Root"), { ...section("Agents"), only: [agentDocs] }],
		})
			.add(
				defineCommand("zeta", { sections: [section("Zeta")] }, (command) =>
					command.action(() => {}),
				),
			)
			.add(
				defineCommand("hidden", { hidden: true, sections: [section("Hidden")] }, (command) =>
					command.add(
						defineCommand("leak", { sections: [section("Leak")] }, (child) =>
							child.action(() => {}),
						),
					),
				),
			)
			.add(
				defineCommand("branch", {}, (command) =>
					command.add(
						defineCommand(
							"leaf",
							{ sections: [{ ...section("Terminal"), only: [terminal] }] },
							(child) => child.action(() => {}),
						),
					),
				),
			)
			.add(
				defineCommand("alpha", { sections: [section("Alpha")] }, (command) =>
					command.action(() => {}),
				),
			);

		const groups = visibleSectionsFor(await app.snapshot(), terminal);

		expect(groups.map(({ path }) => path)).toEqual([[], ["alpha"], ["branch", "leaf"], ["zeta"]]);
		expect(groups.map(({ sections }) => sections.map(({ title }) => title))).toEqual([
			["Root"],
			["Alpha"],
			["Terminal"],
			["Zeta"],
		]);
	});

	it("lets an Extension name itself as the consumer in its own build hook", async () => {
		const webDocs = defineExtension("acme:web-docs").build(({ snapshot }) =>
			visibleSectionsFor(snapshot, webDocs).map(({ path, sections }) => ({
				path: [...path, "docs.md"].join("/"),
				content: sections.map(({ title }) => title).join("\n"),
			})),
		);
		const deploy = defineCommand(
			"deploy",
			{
				sections: [
					{ title: "Safety", body: "Run preview first." },
					{ title: "Screenshots", body: "![preview](preview.png)", only: [webDocs] },
					{ title: "Terminal", body: "Help only", except: [webDocs] },
				],
			},
			(command) => command.action(() => {}),
		);
		const snapshot = await new Crust("my-cli").add(deploy).extend(webDocs).snapshot();

		expect(await definingOf(webDocs).build?.({ snapshot })).toEqual([
			{ path: "deploy/docs.md", content: "Safety\nScreenshots" },
		]);
	});
});
