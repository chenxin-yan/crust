import { powershellSingleQuote } from "../escape.ts";
import type { CompletionArg, CompletionCommand, CompletionFlag } from "../spec.ts";

/**
 * PowerShell completion script renderer.
 *
 * Strategy: emit the command tree as one nested hashtable literal and a
 * fixed `Register-ArgumentCompleter -Native` script block that walks it.
 * The walk mirrors the bash script's: words up to the first positional
 * route through subcommands, a value flag's spelling takes the next word,
 * `--` ends options, a lone `-` is a positional, and a `"passthrough"`
 * argument takes every word from the first positional on, `--` included.
 * The cursor then completes a flag spelling, a flag's value (also as
 * `--name=value`), or a positional slot together with the subcommands at
 * the first one.
 *
 * Values are a definition's `choices`, or the lines `<bin> __complete`
 * prints for its `complete` function. Without values the block returns
 * nothing, and PowerShell offers file names. Spellings and names are
 * compared case-sensitively, as Core does, so the tree uses arrays rather
 * than PowerShell's case-insensitive hashtable keys.
 */

const indentOf = (depth: number) => "\t".repeat(depth);

function quotedList(values: readonly string[]): string {
	return `@(${values.map(powershellSingleQuote).join(", ")})`;
}

/** The completion values of a flag or argument: `Choices` or a `__complete` address. */
function valueEntries(def: CompletionFlag | CompletionArg): string[] {
	if (def.complete !== undefined) return [`Complete = ${powershellSingleQuote(def.complete)}`];
	if (def.choices !== undefined) return [`Choices = ${quotedList(def.choices)}`];
	return [];
}

function renderFlag(flag: CompletionFlag): string {
	const entries = [
		`Spellings = ${quotedList(flag.spellings)}`,
		`Value = ${flag.takesValue ? "$true" : "$false"}`,
		`Desc = ${powershellSingleQuote(flag.description ?? "")}`,
		...(flag.takesValue ? valueEntries(flag) : []),
	];
	return `@{ ${entries.join("; ")} }`;
}

function renderArg(arg: CompletionArg): string {
	const entries = [
		`Variadic = ${powershellSingleQuote(arg.variadic === false ? "" : String(arg.variadic))}`,
		...valueEntries(arg),
	];
	return `@{ ${entries.join("; ")} }`;
}

/** `@( … )` with one item per line, or `@()`. */
function renderArray(items: readonly string[], depth: number): string {
	if (items.length === 0) return "@()";
	const inner = items.map((item) => `${indentOf(depth + 1)}${item}`).join("\n");
	return `@(\n${inner}\n${indentOf(depth)})`;
}

function renderNode(node: CompletionCommand, depth: number): string {
	const subs = node.subCommands.map((sub) => {
		const names = quotedList([sub.name, ...(sub.aliases ?? [])]);
		const desc = powershellSingleQuote(sub.description ?? "");
		return `@{ Names = ${names}; Desc = ${desc}; Node = ${renderNode(sub, depth + 2)} }`;
	});
	const pad = indentOf(depth + 1);
	return [
		"@{",
		`${pad}Subs = ${renderArray(subs, depth + 1)}`,
		`${pad}Flags = ${renderArray(node.flags.map(renderFlag), depth + 1)}`,
		`${pad}Positionals = ${renderArray(node.args.map(renderArg), depth + 1)}`,
		`${indentOf(depth)}}`,
	].join("\n");
}

/**
 * Render a PowerShell completion script for the given spec. Load it from
 * `$PROFILE` (`<bin> completion powershell | Out-String | Invoke-Expression`)
 * or dot-source a saved copy.
 *
 * @param spec     Walker output.
 * @param binName  User-facing binary name; validated upstream.
 * @param version  Free-form version string for the header comment.
 * @param command  Completion subcommand name for the header's regenerate hint.
 */
export function renderPowerShell(
	spec: CompletionCommand,
	binName: string,
	version: string,
	command = "completion",
): string {
	const bin = powershellSingleQuote(binName);
	return `# completion script for ${binName} v${version} — regenerate with: ${binName} ${command} powershell

Register-ArgumentCompleter -Native -CommandName ${bin} -ScriptBlock {
	param($wordToComplete, $commandAst, $cursorPosition)

	$root = ${renderNode(spec, 1)}

	function Find-ValueFlag($command, $spelling) {
		foreach ($flag in $command.Flags) {
			if ($flag.Value -and $flag.Spellings -ccontains $spelling) { return $flag }
		}
	}

	function New-Result($text, $tip, $type = 'ParameterValue') {
		$item = $text
		# A word with spaces or PowerShell syntax is inserted as one quoted argument.
		# PowerShell reads U+2018 to U+201B as single quotes and U+201C to U+201E as double quotes.
		if ($text -match '[\\s''"\`$&|;,(){}@#<>\\u2018-\\u201E]') { $text = "'" + ($text -replace '[''\\u2018-\\u201B]', '$0$0') + "'" }
		if (-not $tip) { $tip = $item }
		[System.Management.Automation.CompletionResult]::new($text, $item, $type, $tip)
	}

	# The words before the cursor, after the command name.
	$words = @(foreach ($element in ($commandAst.CommandElements | Select-Object -Skip 1)) {
		if ($element.Extent.EndOffset -lt $cursorPosition) {
			if ($element -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
				$element.Value
			} else {
				$element.Extent.Text
			}
		}
	})

	$node = $root
	$valueOf = $null
	$endOfOptions = $false
	$noFlags = $false
	$before = 0
	$after = 0
	foreach ($word in $words) {
		if ($null -ne $valueOf) { $valueOf = $null; continue }
		if ($endOfOptions) { $after++; continue }
		# From a "passthrough" argument's first positional on, every word fills a slot, as Core binds it.
		if (-not $noFlags -and $word -ceq '--') { $endOfOptions = $true; continue }
		# A lone - (stdin) is a positional.
		if (-not $noFlags -and $word.Length -gt 1 -and $word.StartsWith('-')) {
			if (-not ($word.StartsWith('--') -and $word.Contains('='))) {
				$valueOf = Find-ValueFlag $node $word
			}
			continue
		}
		if ($before -eq 0) {
			$sub = $node.Subs | Where-Object { $_.Names -ccontains $word } | Select-Object -First 1
			if ($null -ne $sub) { $node = $sub.Node; continue }
		}
		$before++
		if ($node.Positionals.Count -gt 0 -and $node.Positionals[-1].Variadic -ceq 'passthrough') {
			$noFlags = $true
		}
	}

	$word = [string]$wordToComplete
	# PowerShell hands over a quoted word with its quotes; the tree has its value.
	$typed = $commandAst.CommandElements | Where-Object { $_.Extent.StartOffset -lt $cursorPosition -and $_.Extent.EndOffset -ge $cursorPosition } | Select-Object -Last 1
	if ($typed -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $typed.StringConstantType -ne 'BareWord') { $word = $typed.Value }
	$prefix = ''
	$def = $null
	$offerSubs = $false
	if ($null -ne $valueOf) {
		$def = $valueOf
	} elseif (-not $endOfOptions -and -not $noFlags -and $word.StartsWith('-')) {
		if ($word.StartsWith('--') -and $word.Contains('=')) {
			$at = $word.IndexOf('=')
			$prefix = $word.Substring(0, $at + 1)
			$def = Find-ValueFlag $node ($word.Substring(0, $at))
			$word = $word.Substring($at + 1)
			if ($null -eq $def) { return }
		} else {
			foreach ($flag in $node.Flags) {
				foreach ($spelling in $flag.Spellings) {
					if ($spelling.StartsWith($word, [StringComparison]::Ordinal)) {
						New-Result $spelling $flag.Desc 'ParameterName'
					}
				}
			}
			return
		}
	} else {
		$positionals = $node.Positionals
		$count = $positionals.Count
		if ($count -gt 0 -and $positionals[-1].Variadic -ceq 'afterDoubleDash') {
			if ($endOfOptions) { $def = $positionals[-1] }
			elseif ($before -lt $count - 1) { $def = $positionals[$before] }
			elseif ($count -gt 1 -and $positionals[-2].Variadic -ceq 'true') { $def = $positionals[-2] }
		} else {
			$slot = $before + $after
			if ($slot -lt $count) { $def = $positionals[$slot] }
			elseif ($count -gt 0 -and $positionals[-1].Variadic) { $def = $positionals[-1] }
		}
		$offerSubs = -not $endOfOptions -and $before -eq 0
	}

	if ($offerSubs) {
		foreach ($sub in $node.Subs) {
			foreach ($name in $sub.Names) {
				if ($name.StartsWith($word, [StringComparison]::Ordinal)) { New-Result $name $sub.Desc }
			}
		}
	}
	if ($null -eq $def) { return }
	$values = @()
	if ($def.Complete) {
		# Its errors stay off the terminal; a failing call offers nothing.
		try { $values = @(& ${bin} '__complete' '--' $def.Complete $word 2>$null) } catch { }
	} elseif ($def.Choices) {
		$values = $def.Choices
	}
	foreach ($value in $values) {
		if ($value -and $value.StartsWith($word, [StringComparison]::Ordinal)) {
			New-Result ($prefix + $value) $null
		}
	}
}
`;
}
