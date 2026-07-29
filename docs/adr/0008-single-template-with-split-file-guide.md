# Ship one scaffold template and teach split files in a guide

`create-crust` ships only the minimal single-file template. Core keeps both composition forms — parent-typed `.sub(name)` children and standalone builders attached with `.command(builder)` — and the split-file pattern, including its import-order rule, is documented in a dedicated guide instead of a second template. Effect CLI's standalone-value composition was considered; Crust keeps `.sub()` because typed inherited flags in child handlers are a differentiating DX that standalone composition cannot provide.
