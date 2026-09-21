# CLI comparison

Generated from `/home/cyan/dev/github.com/chenxin-yan/crust/scripts/cli-comparison/results/full.json`; 2026-09-20T22:55:06.059Z.
Bun 1.4.2, Node v26.8.2; linux/x64.
Crust local revision: `b79c147ad81549d5cf8755993bf707b539fda996` (harness checkout `b79c147ad81549d5cf8755993bf707b539fda996`). Fingerprint: `509045d7aee9d6515a2fd54c28f99cbb1dc9969cd5783394bf3ce13a08bd419c`.

Portable Node-target ESM bundles, identical settings for all rows and both runtimes. Raw/gzip bytes include adapters and dependencies; builtin implementation cost lives in the runtime. All measured bundles passed the bounded contract on BOTH runtimes outside node_modules.

## Fixture bundle bytes

| Library      | Version         | Kind                           | Minified B | gzip-9 B |
| ------------ | --------------- | ------------------------------ | ---------: | -------: |
| crust        | 0.3.3           | framework (local)              |      34243 |    11735 |
| commander    | 15.0.0          | framework                      |      41301 |    11689 |
| yargs        | 18.1.0          | framework                      |     115588 |    34909 |
| clipanion    | 3.2.1           | framework                      |      58238 |    17361 |
| cleye        | 2.7.0           | framework                      |      47312 |    16735 |
| argparse     | 3.0.2           | command parser                 |      54446 |    16615 |
| stricli      | 1.3.0           | framework                      |      35030 |    11140 |
| arg          | 5.0.2           | parser + routing glue          |       4335 |     2065 |
| minimist     | 1.2.8           | parser + routing glue          |       5558 |     2300 |
| mri          | 1.2.0           | parser + routing glue          |       3890 |     1751 |
| yargs-parser | 22.0.0          | parser + routing glue          |      17484 |     6035 |
| parse-args   | runtime builtin | runtime builtin + routing glue |       1578 |      707 |

## bun: warm invocation and OS-cache-warm startup

Median [p05–p95]. Warm includes fresh schema, parse/route/validate/dispatch, common await and JSON consumption; NOT pure tokenizer speed. Startup includes stdout and process overhead. No empty-process subtraction.
Warm percentiles describe batch-average per-call times, not individual invocation latency: 15 batches of 300 calls. Startup: 30 samples.

| Library       | Adapter |           Warm µs/call |          Startup ms |
| ------------- | ------- | ---------------------: | ------------------: |
| crust         | async   |    58.36 [54.44–66.79] | 18.64 [17.40–19.36] |
| commander     | sync    |    14.90 [13.02–15.89] | 14.84 [13.50–16.60] |
| yargs         | sync    | 718.92 [695.73–733.05] | 34.37 [32.78–35.76] |
| clipanion     | async   |    64.78 [57.21–71.70] | 20.13 [19.23–21.12] |
| cleye         | async   |       7.39 [6.47–9.51] | 18.63 [17.75–20.51] |
| argparse      | sync    | 121.14 [115.46–126.90] | 21.61 [20.30–23.08] |
| stricli       | async   | 145.16 [131.47–148.44] | 17.97 [17.12–19.25] |
| arg           | sync    |       2.89 [1.72–3.06] |    7.12 [6.24–8.09] |
| minimist      | sync    |       5.21 [3.95–8.77] |    7.48 [6.94–8.31] |
| mri           | sync    |       3.91 [3.59–4.06] |    7.32 [6.73–8.44] |
| yargs-parser  | sync    |    15.31 [14.88–18.13] | 13.57 [11.50–14.35] |
| parse-args    | sync    |       2.67 [2.59–3.82] |    8.54 [7.89–9.57] |
| empty process | —       |                      — |    4.43 [3.86–5.10] |

## node: warm invocation and OS-cache-warm startup

Median [p05–p95]. Warm includes fresh schema, parse/route/validate/dispatch, common await and JSON consumption; NOT pure tokenizer speed. Startup includes stdout and process overhead. No empty-process subtraction.
Warm percentiles describe batch-average per-call times, not individual invocation latency: 15 batches of 300 calls. Startup: 30 samples.

| Library       | Adapter |              Warm µs/call |          Startup ms |
| ------------- | ------- | ------------------------: | ------------------: |
| crust         | async   |       65.56 [61.49–90.70] | 42.57 [40.32–46.74] |
| commander     | sync    |       14.81 [14.06–15.52] | 43.83 [40.55–46.37] |
| yargs         | sync    | 1349.67 [1296.88–1402.23] | 79.46 [75.64–82.55] |
| clipanion     | async   |      93.61 [85.50–115.32] | 44.87 [43.25–47.24] |
| cleye         | async   |       14.47 [13.99–15.40] | 45.04 [42.89–47.55] |
| argparse      | sync    |    336.01 [322.01–366.72] | 43.87 [40.96–47.33] |
| stricli       | async   |    272.31 [264.36–306.50] | 40.15 [36.45–43.36] |
| arg           | sync    |          2.37 [2.03–2.77] | 32.01 [30.31–33.82] |
| minimist      | sync    |          6.88 [6.67–7.63] | 32.13 [31.05–34.33] |
| mri           | sync    |          3.48 [3.41–4.82] | 31.63 [30.10–35.64] |
| yargs-parser  | sync    |       43.42 [42.63–44.06] | 36.28 [34.01–38.96] |
| parse-args    | sync    |          6.25 [6.02–7.64] | 32.33 [30.82–36.33] |
| empty process | —       |                         — | 28.07 [26.37–31.66] |

## Not measured (N/A, no ranking penalty)

| Candidate | Version                         | Why this fixture is unsupported/excluded                                                                                                                                                                                      |
| --------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cmd-ts    | 0.15.0                          | Declarative option defaults/optional types treat explicit empty or missing option values as absent. Cannot meet this fixture's rejection contract without extra token inspection; not a claim about every public composition. |
| gunshi    | 0.37.3                          | Normal entry reserves -v globally; config -v invokes version. Public addGlobalOption refuses replacement. No substitution with gunshi/bone or patch; probe retained.                                                          |
| cac       | 7.0.0                           | Numeric-looking strings lose leading zeros before public array transforms. Cannot preserve --region 001 / --tag 002 under this text contract; native probe retained.                                                          |
| citty     | 0.2.2                           | Repeated tags are overwritten; strict unknown-option rejection unavailable in this fixture. Reproducible source probe, not blanket runtime incompatibility.                                                                   |
| sade      | 1.8.1                           | Reserved -v version switch conflicts with config -v value in this chosen contract. Other aliases could work; no monkey patches.                                                                                               |
| oclif     | 5.0.0 (surveyed, not installed) | Full framework requires discovery/package assets; official single-file bundling unsupported. Not substituted with parser-only API; no speed claim.                                                                            |

## Interpretation

One tiny two-command workload; not a feature, help, completion, plugin, memory, security or large-tree comparison. Libraries and bare parsers provide different features. Samples are serial, reproducibly shuffled (seed recorded in raw metadata), machine-specific, and not statistical significance claims. See README.md/research.md for contract, source citations, lifecycle, limitations and reproduction. Raw JSON retains every sample, ordering, configuration, versions, source/bundle hashes and conformance evidence.
