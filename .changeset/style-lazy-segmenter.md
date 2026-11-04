---
"@crustjs/style": patch
---

Create the `Intl.Segmenter` used by the Node `stringWidth()` fallback on first non-ASCII measurement instead of at import, and measure ANSI-styled ASCII without grapheme segmentation.
