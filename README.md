# Worthune SDKs

Official SDKs for the [Worthune Model API](https://worthune.com/docs) — **27
financial calculation models you can cite, audit, and trust**, callable over
REST or MCP. Free with attribution, no API keys.

- **JavaScript / TypeScript**: [`npm install worthune`](./js) — zero dependencies, Node 18+ and browsers
- **Python**: [`pip install worthune`](./python) — zero dependencies, Python 3.9+
- **No SDK at all**: it's plain JSON over HTTPS — `POST https://worthune.com/api/v1/models/{model}`
- **MCP** (Claude, ChatGPT, agents): `https://worthune.com/api/mcp/mcp` — `com.worthune/models` in the [official MCP registry](https://registry.modelcontextprotocol.io)

## Why these models are different

Financial calculators are easy to write and easy to get subtly wrong. Worthune
treats accuracy as an artifact, not a claim:

1. **Every model has a published spec** — inputs, units, valid domains, exact
   formulas, assumptions, exclusions. The spec is one GET request:
   `GET /api/v1/models/{model}/spec`.
2. **Two implementations must agree.** Each model is independently rebuilt
   from its spec, and both implementations must match on 250 fuzzed cases per
   model (6,750 total) before any change ships. Disagreement anywhere stops
   the release.
3. **Constants have provenance.** IRS limits, brackets, and SSA factors come
   from a [sourced registry](https://worthune.com/facts) with primary-source
   citations and verification dates — and every response cites the constants
   it used.
4. **No silent changes.** Model behavior changes ship as spec version bumps
   with a [public changelog](https://worthune.com/models/changelog).
   Responses pin their `specVersion`.

## Sixty seconds to a verified computation

```js
import { Worthune, verifyRecord } from "worthune";

const client = new Worthune();
const result = await client.run("relocation", {
  currentSalary: 95000, newSalary: 108000,
  currentMonthlyExpenses: 4200, newMonthlyExpenses: 4900,
  movingCosts: 6000, currentSavings: 40000,
  annualReturn: 0.07, yearsHorizon: 10,
});

result.outputs.breakEvenMonths;   // 16
result.specVersion;               // "1.0.0" — pinned contract
result.facts;                     // IRS/SSA constants used, with sources
await verifyRecord(result);       // true — SHA-256 audit fingerprint checks out
```

```python
from worthune import Worthune, verify_record

client = Worthune()
result = client.run("relocation", {...})
result["outputs"]["breakEvenMonths"]
verify_record(result)  # True
```

## What's in the box

| Capability | JS | Python |
| --- | --- | --- |
| Run any of the 27 models | `client.run(model, inputs)` | `client.run(model, inputs)` |
| Machine-readable contract | `client.getContract(model)` | `client.get_contract(model)` |
| Full spec (markdown) | `client.getSpec(model)` | `client.get_spec(model)` |
| Eval datasets (ground truth for financial AI) | `client.getEvalDataset(model)` | `client.get_eval_dataset(model)` |
| Sourced IRS/SSA constants | `client.getFacts()` | `client.get_facts()` |
| Decision-record verification | `verifyRecord(response)` | `verify_record(response)` |

**Decision records:** every successful response includes `record.sha256` — a
hash over the canonical JSON of `{model, specVersion, inputs, outputs}` (keys
sorted recursively). Store it next to anything you build on the outputs;
recompute it later to prove the numbers came from that spec version,
unaltered. Both SDKs implement the recipe, byte-exactly.

## Fair use & attribution

Everything here is free with attribution — a visible "Powered by Worthune"
with a link where end users see results. Fair use is 5,000 model runs a month
per app (a guideline, not a meter). The details, in writing:
[worthune.com/pricing](https://worthune.com/pricing).

## What this repo is (and isn't)

This repo contains the API clients, examples, and their tests. The models
themselves — the specs, the verified engine, the second implementation, and
the facts pipeline — live behind the API at
[worthune.com](https://worthune.com). That separation is the product: you get
verified computation as a service, without owning the verification burden.

## License

MIT (the SDK code in this repository). API usage is governed by the
[Worthune terms](https://worthune.com/terms).
