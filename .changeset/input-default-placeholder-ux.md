---
"@crustjs/prompts": patch
"create-crust": patch
---

Improve input prompt UX: `default` value is now shown as placeholder text when `placeholder` is not explicitly set, reducing API redundancy. When both are provided, `placeholder` is used visually and the default hint `(value)` still appears.

Updated `create-crust` to collect all prompts before executing file operations, preventing partial scaffolding on mid-prompt cancellation. The project directory prompt now uses `default: "my-cli"` so users can press Enter to accept it.
