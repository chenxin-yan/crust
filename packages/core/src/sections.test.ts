import { describe, expect, it } from "vite-plus/test";

import { defineCommand, Crust } from "./command/crust.ts";
import { defineExtensionId } from "./identity.ts";
import { sectionsFor, visibleSectionsFor } from "./sections.ts";
import type { CommandSectionInput } from "./types.ts";

const agentDocs = defineExtensionId("agent-docs");
const terminal = defineExtensionId("terminal");

it("rejects conflicting audiences hidden by a structural view", () => {
	const original: CommandSectionInput = {
		title: "Notes",
		body: "For humans",
		except: [agentDocs],
	};
	function withOnly(section: {
		readonly title: string;
		readonly body: string;
	}): CommandSectionInput {
		return { ...section, only: [agentDocs] };
	}

	expect(() => new Crust("demo", { sections: [withOnly(original)] })).toThrow(
		expect.objectContaining({
			code: "DEFINITION",
			details: { subject: "command", name: "demo", reason: "invalid-sections" },
		}),
	);
});

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
});
