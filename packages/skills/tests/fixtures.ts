import type {
	ArgDef,
	CommandDefinition,
	CommandSection,
	CommandSnapshot,
	FlagDef,
} from "@crustjs/core";
import { Crust, defineCommand } from "@crustjs/core";
import { vi } from "vite-plus/test";

import { AGENTS } from "../src/agents.generated.ts";

/** Unsets every variable that relocates an agent's global directory, so the host's do not leak in. */
export function stubAgentOverridesUnset(): void {
	for (const row of Object.values(AGENTS)) {
		if (row.length === 5) vi.stubEnv(row[3], undefined);
	}
}

export async function withCwd<T>(dir: string, run: () => Promise<T>): Promise<T> {
	// Preserve the original method for restoration; it is never called unbound.
	// oxlint-disable-next-line typescript/unbound-method
	const cwd = process.cwd;
	process.cwd = () => dir;
	try {
		return await run();
	} finally {
		process.cwd = cwd;
	}
}

/** Runs with `dir` as the home directory (`HOME`, and `USERPROFILE` on Windows). */
export async function withHome<T>(dir: string, run: () => Promise<T>): Promise<T> {
	const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
	process.env.HOME = dir;
	process.env.USERPROFILE = dir;
	try {
		return await run();
	} finally {
		for (const [name, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

export interface CommandFixture {
	meta: {
		name: string;
		description?: string;
		usage?: string;
		hidden?: boolean;
		sections?: readonly CommandSection[];
	};
	args?: readonly ArgDef[];
	flags?: Record<string, FlagDef>;
	run?: () => void;
	subCommands?: Record<string, CommandFixture>;
}

export function makeCommand(opts: CommandFixture): CommandFixture {
	return opts;
}

function fixtureDefinition(fixture: CommandFixture): CommandDefinition<any, any, any, any> {
	const { name, ...meta } = fixture.meta;
	return defineCommand(name, meta, (command) => {
		const configured = command
			.args(...(fixture.args ?? []))
			.flags(fixture.flags ?? {})
			.add(...Object.values(fixture.subCommands ?? {}).map(fixtureDefinition));
		return fixture.run ? configured.action(fixture.run) : configured;
	});
}

export async function snapshotFixture(fixture: CommandFixture): Promise<CommandSnapshot> {
	const { name, hidden: _hidden, ...meta } = fixture.meta;
	const root = new Crust(name, meta)
		.args(...(fixture.args ?? []))
		.flags(fixture.flags ?? {})
		.add(...Object.values(fixture.subCommands ?? {}).map(fixtureDefinition));
	return await (fixture.run ? root.action(fixture.run) : root).snapshot();
}
