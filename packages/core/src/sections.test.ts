import { describe, expect, it } from "bun:test";

import { defineCommand, Crust } from "./command/crust.ts";
import { defineExtensionId } from "./identity.ts";
import { isListed, sectionsFor, visibleSectionsFor } from "./tooling.ts";
import type { CommandSection, CommandSectionInput } from "./types.ts";

const universal = { title: "Universal", body: "Everywhere" } as const;
const agentDocs = defineExtensionId("agent-docs");
const terminal = defineExtensionId("terminal");

describe("isListed", () => {
	it("excludes only explicitly hidden commands", async () => {
		const visible = await new Crust("visible").snapshot();
		const hidden = await new Crust("hidden")
			.add(defineCommand("child", { hidden: true }, (command) => command))
			.snapshot();

		expect(isListed(visible)).toBe(true);
		expect(isListed(hidden.subCommands.child!)).toBe(false);
	});
});

describe("sectionsFor", () => {
	it("includes untargeted sections for every consumer", () => {
		expect(sectionsFor([universal], terminal)).toEqual([universal]);
	});

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

	it("matches consumer ids after structured cloning", () => {
		const sections = structuredClone([
			{ title: "Agent notes", body: "For agents", only: [agentDocs] },
		]) as CommandSection[];
		expect(sectionsFor(sections, agentDocs)).toEqual(sections);
	});
});

describe("visibleSectionsFor", () => {
	it("collects audience-visible sections in canonical path order and skips hidden trees", async () => {
		const section = (title: string) => ({ title, body: `${title} body` });
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
});

// Compile-time regression checks; intentionally never invoked.
// requires minted Extension ids in section audiences
function _typecheckRequiresMintedExtensionIdsInSectionAudiences() {
	const invalid: CommandSectionInput = {
		title: "Invalid",
		body: "Invalid",
		// @ts-expect-error section audiences reject raw strings
		only: ["raw"],
	};
	void invalid;
}
