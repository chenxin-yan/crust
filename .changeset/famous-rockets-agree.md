---
"@crustjs/skills": patch
---

`skills install` (and its bare `skills` shorthand) is now additive only: it links or repairs the selected skills for the selected agents and never removes existing links. Deselecting an agent or skill during an interactive install leaves its installed link untouched; removal happens exclusively through `skills uninstall`.
