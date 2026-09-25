import { RuleTester } from "vite-plus/lint/plugins-dev";
import { describe, it } from "vite-plus/test";

// RuleTester declares every valid/invalid case through these hooks, so Vitest collects each case.
RuleTester.describe = describe;
RuleTester.it = it;
