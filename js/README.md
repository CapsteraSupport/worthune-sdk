# worthune

Zero-dependency SDK for the [Worthune Model API](https://worthune.com/docs) —
verified financial calculation models you can cite, audit, and trust. No API
keys. Free with attribution.

Every model has a **published spec**, an **independent second implementation
that must agree** with the first on 250 fuzzed cases before anything ships,
and **IRS/SSA constants traced to primary sources**. Model changes are never
silent: responses pin `specVersion`, and the
[changelog is public](https://worthune.com/models/changelog).

```bash
npm install worthune
```

```js
import { Worthune, verifyRecord } from "worthune";

const client = new Worthune();

const result = await client.run("relocation", {
  currentSalary: 95000, newSalary: 108000,
  currentMonthlyExpenses: 4200, newMonthlyExpenses: 4900,
  movingCosts: 6000, currentSavings: 40000,
  annualReturn: 0.07, yearsHorizon: 10,
});

result.outputs.breakEvenMonths;  // 16
result.specVersion;              // pinned contract version
result.facts;                    // IRS/SSA constants used, with sources
result.sentinels;                // special values, explained
await verifyRecord(result);      // true — audit fingerprint checks out
```

Works in Node 18+, browsers, and edge runtimes (anything with `fetch` and Web
Crypto).

## API

- `client.listModels()` — catalog with spec versions
- `client.getContract(model)` — machine-readable inputs/domains/sentinels
- `client.getSpec(model)` — the full published spec (markdown)
- `client.run(model, inputs)` — run; validation failures return `{ok: false, errors}` instead of throwing
- `client.getEvalDataset(model)` — 250 verified input/expected-output pairs, the exact cases Worthune's dual-implementation CI verifies (ground truth for financial AI testing)
- `client.getFacts()` — the sourced IRS/SSA constants registry
- `verifyRecord(response)` — recompute the SHA-256 decision record to prove where numbers came from
- `canonicalJson(value)` — the canonical serialization the record hashes

Retirement, FIRE, rent vs. buy, loans and credit, retirement tax (RMDs,
Roth ladders, capital gains), and startup finance (SAFE dilution, burn rate,
SBA loan cost) — the catalog grows in verified packs; `client.listModels()`
or the [live catalog](https://worthune.com/models) is always current.

Fair use: 5,000 runs/month per app (a guideline, not a meter) —
[the free tier, in writing](https://worthune.com/pricing).

MIT licensed. The models, specs, and verification harness live behind the API
at [worthune.com](https://worthune.com).
