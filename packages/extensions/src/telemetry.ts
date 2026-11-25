import {
	type CommandDefinition,
	type CommandShape,
	type CrustCommandContext,
	type Extension,
	type ExtensionContext,
	type ExtensionFactory,
	type ExtensionId,
	type InvocationOutcome,
	defineCommand,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import type { StandardJSONSchema, StandardSchema } from "@crustjs/utils/schema";

const TELEMETRY: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:telemetry");

/** One usage event. It never carries argument or flag values. */
export interface TelemetryEvent {
	/** Canonical names from the application root through the command that ran, e.g. `["acme", "deploy"]`. */
	readonly command: readonly string[];
	/** The invocation's outcome as this Extension's `postRun` saw it. */
	readonly outcome: InvocationOutcome["status"];
	/** Whole milliseconds from this Extension's `setup` to its `postRun`; `0` when its `setup` never ran. */
	readonly durationMs: number;
	/** Whether `CI` is set to something other than empty, `0`, or `false`. */
	readonly ci: boolean;
}

export interface TelemetryOptions {
	/**
	 * Environment variable through which the user turns telemetry on or off for the runs where it
	 * is set, such as `"ACME_TELEMETRY"`: `0` or `false` (any letter case) turns it off, any other
	 * non-empty value on, over the saved setting. `DO_NOT_TRACK` set to anything but empty or `0`
	 * turns it off over both.
	 */
	env: string;
	/**
	 * What applies when neither variable nor a saved setting decides: `"opt-in"` sends nothing,
	 * `"opt-out"` sends.
	 */
	enabled: "opt-in" | "opt-out";
	/**
	 * Name of the contributed command that shows the state and saves the user's choice
	 * (`status`, `enable`, `disable`). A literal name keeps the host's command tree type-checked;
	 * a dynamic `string` opens it.
	 * @default "telemetry"
	 */
	command?: string;
	/**
	 * Delivers one event. Waited for at most 1 second, when `signal` aborts with a `TimeoutError`;
	 * pass `signal` to the request so it ends too, or it keeps the process alive. Failures are ignored.
	 */
	send: (event: TelemetryEvent, options: { readonly signal: AbortSignal }) => Promise<void>;
}

/** What the `telemetry` command prints under `--json` and returns as its result. */
export interface TelemetryStatus {
	/** Whether an invocation settling now, with this environment, would send its event. */
	readonly sending: boolean;
	/** The first setting that decides: `DO_NOT_TRACK`, the app's variable, the saved choice, or `enabled`. */
	readonly decidedBy: "do-not-track" | "env" | "saved" | "default";
	/** The saved choice; `"unreadable"` when the file cannot be read, absent when nothing is saved. */
	readonly saved?: SavedSetting;
	/** `"on"` under `"opt-out"`, `"off"` under `"opt-in"`. */
	readonly default: "on" | "off";
}

export type SavedSetting = "on" | "off" | "unreadable";

const STATUS_JSON_SCHEMA = {
	type: "object",
	properties: {
		sending: { type: "boolean", description: "Whether this run would send events" },
		decidedBy: {
			type: "string",
			enum: ["do-not-track", "env", "saved", "default"],
			description: "The first setting that decides",
		},
		saved: {
			type: "string",
			enum: ["on", "off", "unreadable"],
			description: "The saved choice; absent when nothing is saved",
		},
		default: {
			type: "string",
			enum: ["on", "off"],
			description: "What applies when nothing else decides",
		},
	},
	required: ["sending", "decidedBy", "default"],
	additionalProperties: false,
};

const statusSchema: StandardSchema<TelemetryStatus> & StandardJSONSchema<TelemetryStatus> = {
	"~standard": {
		version: 1,
		vendor: "crust",
		// SAFETY: only the actions below return here, and TypeScript checks that they return a status.
		validate: (value) => ({ value: value as TelemetryStatus }),
		jsonSchema: { input: () => STATUS_JSON_SCHEMA, output: () => STATUS_JSON_SCHEMA },
	},
};

const DEFAULT_TELEMETRY_COMMAND = "telemetry";

type TelemetrySubcommandShape = CommandShape<[], {}, {}, TelemetryStatus, {}>;

/** The contributed command, spelled out because the exported factory needs a declared type. */
type TelemetryCommandDefinition<Command extends string = typeof DEFAULT_TELEMETRY_COMMAND> =
	CommandDefinition<
		Command,
		readonly [],
		CommandShape<
			[],
			{},
			{
				status: TelemetrySubcommandShape;
				enable: TelemetrySubcommandShape;
				disable: TelemetrySubcommandShape;
			},
			TelemetryStatus,
			{}
		>
	>;

// A non-literal name cannot be keyed statically, so it keeps the open command namespace.
type TelemetryCommands<Command extends string> = string extends Command
	? readonly CommandDefinition<any, any, any, any>[]
	: readonly [TelemetryCommandDefinition<Command>];

/**
 * {@link telemetry}'s signature: a `command` that is always present flows into the host's
 * command tree, an absent one is `telemetry`, and a possibly absent one stays open.
 */
interface TelemetryExtension {
	<const Command extends string>(
		options: TelemetryOptions & { command: Command },
	): Extension<{}, [], {}, TelemetryCommands<Command>>;
	(
		options: TelemetryOptions & { command?: undefined },
	): Extension<{}, [], {}, readonly [TelemetryCommandDefinition]>;
	// Omitted `Commands` is the open command namespace.
	(options: TelemetryOptions): Extension<{}, [], {}>;
	readonly id: ExtensionId;
}

const SEND_TIMEOUT_MS = 1_000;

/** Per invocation: `performance.now()` when this Extension's `setup` ran. */
const startedAt = /* @__PURE__ */ new WeakMap<ExtensionContext, number>();

/**
 * Which setting wins, for `postRun` and the command alike: `DO_NOT_TRACK`, the app's variable,
 * the saved choice, then `enabled`. `readSaved` runs only when neither variable decides, so most
 * runs never load the store. The variables are read from `process.env`.
 */
async function decide(
	options: TelemetryOptions,
	readSaved: () => Promise<SavedSetting | undefined>,
): Promise<Pick<TelemetryStatus, "sending" | "decidedBy">> {
	const doNotTrack = process.env.DO_NOT_TRACK;
	if (doNotTrack && doNotTrack !== "0") return { sending: false, decidedBy: "do-not-track" };
	const value = process.env[options.env];
	if (value === "0" || value?.toLowerCase() === "false")
		return { sending: false, decidedBy: "env" };
	if (value) return { sending: true, decidedBy: "env" };
	const saved = await readSaved();
	// Reached only when neither variable decides: then an unreadable file sends nothing.
	if (saved !== undefined) return { sending: saved === "on", decidedBy: "saved" };
	return { sending: options.enabled === "opt-out", decidedBy: "default" };
}

/** The contributed command: bare, it is `status`; `enable` and `disable` save, then report the result. */
function telemetryCommand(options: TelemetryOptions, name: string) {
	const report =
		(change: "on" | "off" | undefined) =>
		async ({ rootCommand, stdout }: Pick<CrustCommandContext, "rootCommand" | "stdout">) => {
			// The file access and the wording load only when the command runs.
			const setting = await import("./telemetry-setting.ts");
			const file = setting.settingFile(rootCommand.meta.name);
			if (change) await setting.writeSavedSetting(file, change, options.env);
			const saved = change ?? (await setting.readSavedSetting(file));
			const status: TelemetryStatus = {
				...(await decide(options, async () => saved)),
				...(saved && { saved }),
				default: options.enabled === "opt-out" ? "on" : "off",
			};
			stdout(
				setting.describeStatus(
					status,
					change,
					`${rootCommand.meta.name} ${name}`,
					options.env,
					file,
				),
			);
			return status;
		};
	const subcommand = <SubName extends "status" | "enable" | "disable">(
		subName: SubName,
		description: string,
		change: "on" | "off" | undefined,
	) =>
		defineCommand(subName, { description }, (cmd) =>
			cmd.output(statusSchema).action(report(change)),
		);
	return defineCommand(
		name,
		{ description: "Show whether usage telemetry is sent, and why (shorthand for `status`)" },
		(cmd) =>
			cmd
				.add(
					subcommand(
						"status",
						"Show whether usage telemetry is sent and which setting decides it",
						undefined,
					),
					subcommand("enable", "Save a preference to send usage telemetry", "on"),
					subcommand("disable", "Save a preference not to send usage telemetry", "off"),
				)
				.output(statusSchema)
				.action(report(undefined)),
	);
}

const telemetryFactory: ExtensionFactory<
	[options: TelemetryOptions],
	{},
	[],
	{},
	readonly [TelemetryCommandDefinition<string>]
> = /* @__PURE__ */ defineExtension(TELEMETRY).factory((extension, options) => {
	const commandName = options.command ?? DEFAULT_TELEMETRY_COMMAND;
	return extension
		.add(telemetryCommand(options, commandName))
		.setup((ctx) => {
			startedAt.set(ctx, performance.now());
		})
		.postRun(async (ctx, outcome) => {
			// Before the decision: reading the saved preference is not the command's time.
			const endedAt = performance.now();
			// The control command never reports itself: not a status check, an opt-out, its help, or its failures.
			if (ctx.commandPath[1] === commandName) return;
			const { sending } = await decide(options, async () => {
				// Loaded only when neither variable decides, keeping it out of every CLI's startup.
				const { readSavedSetting, settingFile } = await import("./telemetry-setting.ts");
				return readSavedSetting(settingFile(ctx.commandPath[0]!));
			});
			if (!sending) return;
			const started = startedAt.get(ctx);
			const durationMs = started === undefined ? 0 : Math.round(endedAt - started);
			// Loaded only when sending, keeping it out of every CLI's startup.
			const { isCI } = await import("@crustjs/utils/terminal");
			const event: TelemetryEvent = {
				command: ctx.commandPath,
				outcome: outcome.status,
				durationMs,
				ci: isCI(),
			};
			// Its own deadline, not `ctx.signal`: that is already aborted after Ctrl-C.
			const deadline = new AbortController();
			const timer = setTimeout(
				() => deadline.abort(new DOMException("Telemetry send timed out.", "TimeoutError")),
				SEND_TIMEOUT_MS,
			);
			try {
				// The race stops the wait even when `send` ignores the signal.
				await Promise.race([
					options.send(event, { signal: deadline.signal }),
					new Promise<void>((resolve) => {
						deadline.signal.addEventListener("abort", () => resolve(), { once: true });
					}),
				]);
			} catch {
				// Telemetry never changes the invocation's outcome.
			} finally {
				clearTimeout(timer);
			}
		});
});

// SAFETY: the runtime command name is `options.command ?? "telemetry"`, which each overload's name restates.
/**
 * Sends one usage event per invocation through the app's `send`, after the invocation settles.
 * Reports the outcome this Extension's `postRun` sees; an unknown command or flag fails before setup and sends nothing.
 * Contributes a `telemetry` command (`status`, `enable`, `disable`) through which the user saves a preference
 * for this machine; that command's own invocations never send an event.
 *
 * @see https://crustjs.com/docs/modules/extensions/telemetry
 */
export const telemetry = telemetryFactory as TelemetryExtension;
