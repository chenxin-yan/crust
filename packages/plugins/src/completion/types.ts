import type { ArgDef, CommandNode, FlagDef } from "@crustjs/core";

export type CompletionShell = "bash" | "fish" | "zsh";

export type CompletionItem = string | { value: string; description?: string };

export type CompletionPosition =
	| "subcommand"
	| "flag-name"
	| "flag-value"
	| "arg"
	| "subcommand-or-arg";

export interface CompletionContext {
	shell: CompletionShell;
	command: CommandNode;
	commandPath: readonly string[];
	position: CompletionPosition;
	tokensBeforeCurrent: readonly string[];
	currentToken: string;
	currentIndex: number;
	parsedFlags: Record<string, unknown>;
	parsedArgs: string[];
	flagName?: string;
	arg?: ArgDef;
}

export type CompletionProvider = (
	context: CompletionContext,
) =>
	| CompletionItem
	| readonly CompletionItem[]
	| Promise<CompletionItem | readonly CompletionItem[]>;

export interface CompletionPluginOptions {
	command?: string;
	binName?: string;
}

export type CompletionSource = readonly CompletionItem[] | CompletionProvider;

export type CompletionArgDef<T extends ArgDef = ArgDef> = T & {
	readonly [COMPLETION_SOURCE]?: CompletionSource;
};

export type CompletionFlagDef<T extends FlagDef = FlagDef> = T & {
	readonly [COMPLETION_SOURCE]?: CompletionSource;
};

export const COMPLETION_SOURCE: unique symbol = Symbol.for(
	"@crustjs/plugins/completion/source",
) as never;
