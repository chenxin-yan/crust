# `@crustjs/render`

Terminal rendering primitives for the Crust CLI ecosystem.

## Features

- Shared document IR for terminal rendering
- Render markdown into terminal-friendly output
- GitHub Flavored Markdown support for tables, task lists, and autolinks
- Width-aware wrapping that stays ANSI-safe
- Theme integration via `@crustjs/style`
- Optional streaming controller for transient `stderr` updates

## Installation

```sh
bun add @crustjs/render @crustjs/style
```

## Usage

```ts
import { renderMarkdown } from "@crustjs/render";

const output = renderMarkdown("# Hello\n\nVisit <https://crustjs.com>", {
	style: { mode: "auto" },
	width: 80,
});

console.log(output);
```

## Architecture

`@crustjs/render` is structured in two layers:

- format adapters convert an input format into a shared render document
- the terminal serializer renders that document into terminal-friendly text

Markdown is the only built-in format in v1, but the internal document model is
designed so future adapters like HTML can reuse the same serializer.

```ts
import { markdownToDocument, renderDocument } from "@crustjs/render";

const document = markdownToDocument("# Hello");
console.log(renderDocument(document, { style: { mode: "never" } }));
```

## Custom Themes

`@crustjs/render` consumes the semantic markdown theme contract from
`@crustjs/style`.

```ts
import { createMarkdownTheme } from "@crustjs/style";
import { renderMarkdown } from "@crustjs/render";

const theme = createMarkdownTheme({
	overrides: {
		heading1: (value) => value.toUpperCase(),
	},
});

console.log(renderMarkdown("# title", { theme }));
```

## Streaming

```ts
import {
	createDocumentStreamRenderer,
	createMarkdownStreamRenderer,
	markdownToDocument,
} from "@crustjs/render";

const markdownStream = createMarkdownStreamRenderer();

markdownStream.append("# Loading");
markdownStream.append("\n\nStill streaming...");
markdownStream.close({ persist: true });

const documentStream = createDocumentStreamRenderer();
documentStream.replace(markdownToDocument("## Shared pipeline"));
documentStream.close({ persist: true });
```

Both streaming renderers repaint transient frames on `stderr`. The markdown
stream is now a thin adapter on top of the shared document stream layer.
