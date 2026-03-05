---
"@crustjs/skills": patch
---

Refactor skills agent handling to support a broader agent matrix with a universal install group. Detection now uses CLI command probes for additional agents, universal targets are exposed as a single selectable option, and prompt behavior includes already-installed additional targets even when the agent binary is not detected. Also simplify `crust.json` metadata and align docs with the new install and detection model.
