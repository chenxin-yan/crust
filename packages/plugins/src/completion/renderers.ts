import type { CompletionShell } from "./types.ts";

function bashFunctionName(binName: string): string {
	return `_${binName.replace(/[^A-Za-z0-9_]/g, "_")}_completion`;
}

function zshFunctionName(binName: string): string {
	return `_${binName.replace(/[^A-Za-z0-9_]/g, "_")}_completion`;
}

function q(value: string): string {
	return JSON.stringify(value);
}

function renderBashScript(binName: string, commandName: string): string {
	const functionName = bashFunctionName(binName);
	return `#!/usr/bin/env bash

${functionName}() {
\tlocal current="\${COMP_WORDS[COMP_CWORD]}"
\tlocal index=$((COMP_CWORD - 1))
\tlocal -a before=()
\tlocal i
\tfor ((i = 1; i < COMP_CWORD; i++)); do
\t\tbefore+=("\${COMP_WORDS[i]}")
\tdone

\tlocal output
\tif ! output="$(${q(binName)} ${q(commandName)} __complete bash --index "$index" --current "$current" -- "\${before[@]}")"; then
\t\tCOMPREPLY=()
\t\treturn 0
\tfi

\tCOMPREPLY=()
\tif [[ -n "$output" ]]; then
\t\tlocal -a lines=()
\t\tmapfile -t lines <<< "$output"
\t\tlocal line
\t\tfor line in "\${lines[@]}"; do
\t\t\t[[ -z "$line" ]] && continue
\t\t\tCOMPREPLY+=("\${line%%$'\\t'*}")
\t\tdone
\tfi
}

complete -o bashdefault -o default -F ${functionName} ${q(binName)}
`;
}

function renderZshScript(binName: string, commandName: string): string {
	const functionName = zshFunctionName(binName);
	return `#compdef ${binName}

${functionName}() {
\tlocal current="\${words[CURRENT]}"
\tlocal index=$((CURRENT - 2))
\tlocal -a before=()
\tif (( CURRENT > 2 )); then
\t\tbefore=(\${words[2,CURRENT-1]})
\tfi

\tlocal output
\tif ! output="$(${q(binName)} ${q(commandName)} __complete zsh --index "$index" --current "$current" -- "\${before[@]}")"; then
\t\treturn 1
\tfi

\tlocal -a lines=("\${(@f)output}")
\tlocal -a values=()
\tlocal -a described=()
\tlocal line value
\tfor line in "\${lines[@]}"; do
\t\t[[ -z "$line" ]] && continue
\t\tvalue="\${line%%$'\\t'*}"
\t\tvalues+=("$value")
\t\tif [[ "$line" == *$'\\t'* ]]; then
\t\t\tdescribed+=("$value:\${line#*$'\\t'}")
\t\tfi
\tdone

\tif (( \${#described[@]} > 0 )); then
\t\t_describe values described
\t\treturn 0
\tfi

\tif (( \${#values[@]} > 0 )); then
\t\tcompadd -- "\${values[@]}"
\t\treturn 0
\tfi

\treturn 1
}

${functionName} "$@"
`;
}

function renderFishScript(binName: string, commandName: string): string {
	const functionName = `__${binName.replace(/[^A-Za-z0-9_]/g, "_")}_completion`;
	return `function ${functionName}
\tset -l current (commandline -ct)
\tset -l tokens (commandline -opc)
\tif test (count $tokens) -gt 0
\t\tset -e tokens[1]
\tend
\tif test (count $tokens) -gt 0
\t\tif test "$tokens[-1]" = "$current"
\t\t\tset -e tokens[-1]
\t\tend
\tend
\tset -l index (count $tokens)
\t${binName} ${commandName} __complete fish --index $index --current "$current" -- $tokens
end

complete -c ${binName} -f -a "(${functionName})"
`;
}

export function renderCompletionScript(params: {
	binName: string;
	commandName: string;
	shell: CompletionShell;
}): string {
	switch (params.shell) {
		case "bash":
			return renderBashScript(params.binName, params.commandName);
		case "fish":
			return renderFishScript(params.binName, params.commandName);
		case "zsh":
			return renderZshScript(params.binName, params.commandName);
	}
}
