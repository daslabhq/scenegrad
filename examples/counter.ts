/**
 * Counter — the smallest scenegrad example.
 *
 * Goal: count = 5. Tools: inc, dec. Greedy increments until done.
 * No LLM needed — proves the substrate types compose.
 *
 * Run: bun examples/counter.ts
 */

import { defineEnv, GreedySolver } from "scenegrad";

const counter = defineEnv({
  init:  () => ({ count: 0 }),
  goal:  (s) => [{
    name: "count = 5",
    check: (s) => ({ satisfied: s.count === 5, gap: Math.abs(5 - s.count) }),
  }],
  tools: () => [{ name: "inc", args: {} }, { name: "dec", args: {} }],
  step:  (s, t) => t.name === "inc" ? { count: s.count + 1 } : { count: s.count - 1 },
});

const result = await new GreedySolver().solve(counter, "default");
console.log(`success=${result.success}  steps=${result.steps}  d:${result.d_initial}→${result.d_final}`);
for (const t of result.trajectory) {
  console.log(`  #${t.step} ${t.tool?.name}  d:${t.d_before}→${t.d_after}`);
}
