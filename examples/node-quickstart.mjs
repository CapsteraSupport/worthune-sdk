// Worthune SDK quickstart (Node 18+).
//   npm install worthune
//   node node-quickstart.mjs
import { Worthune, verifyRecord } from "worthune";

const client = new Worthune();

// 1. Run a verified model — no keys required.
const result = await client.run("relocation", {
  currentSalary: 95000,
  newSalary: 108000,
  currentMonthlyExpenses: 4200,
  newMonthlyExpenses: 4900,
  movingCosts: 6000,
  currentSavings: 40000,
  annualReturn: 0.07,
  yearsHorizon: 10,
});

if (!result.ok) {
  console.error("validation failed:", result.errors);
  process.exit(1);
}

console.log("break-even months:", result.outputs.breakEvenMonths);
console.log("spec version:", result.specVersion);
console.log("assumptions:", result.assumptions);

// 2. Verify the decision record — proves these numbers came from this spec
//    version with these inputs, unaltered. Store result.record with anything
//    you build on the outputs.
console.log("record verifies:", await verifyRecord(result));

// 3. Ground truth for your own eval harness: the exact cases Worthune's
//    dual-implementation CI verifies.
const dataset = await client.getEvalDataset("fire");
console.log(`eval dataset: ${dataset.meta.count} cases @ spec v${dataset.meta.specVersion}`);
