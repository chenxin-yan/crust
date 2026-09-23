import type {
	AnyCrust,
	ArgDef,
	CommandDefinition,
	CommandSection,
	CommandSnapshot,
	FlagDef,
} from "@crustjs/core";
import { Crust, defineCommand } from "@crustjs/core";

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
			.flags(
				...Object.entries(fixture.flags ?? {}).map(([flagName, def]) => ({
					name: flagName,
					...def,
				})),
			)
			.add(...Object.values(fixture.subCommands ?? {}).map(fixtureDefinition));
		return fixture.run ? configured.action(fixture.run) : configured;
	});
}

export async function snapshotFixture(
	fixture: CommandFixture | AnyCrust,
): Promise<CommandSnapshot> {
	if ("snapshot" in fixture) return await fixture.snapshot();
	const { name, hidden: _hidden, ...meta } = fixture.meta;
	const root = new Crust(name, meta)
		.args(...(fixture.args ?? []))
		.flags(
			...Object.entries(fixture.flags ?? {}).map(([flagName, def]) => ({ name: flagName, ...def })),
		)
		.add(...Object.values(fixture.subCommands ?? {}).map(fixtureDefinition));
	return await (fixture.run ? root.action(fixture.run) : root).snapshot();
}
