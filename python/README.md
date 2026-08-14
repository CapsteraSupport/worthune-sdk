# worthune

Zero-dependency SDK for the [Worthune Model API](https://worthune.com/docs) —
27 financial calculation models you can cite, audit, and trust. No API keys.
Free with attribution.

Every model has a **published spec**, an **independent second implementation
that must agree** with the first on 250 fuzzed cases before anything ships,
and **IRS/SSA constants traced to primary sources**. Model changes are never
silent: responses pin `specVersion`, and the
[changelog is public](https://worthune.com/models/changelog).

```bash
pip install worthune
```

```python
from worthune import Worthune, verify_record

client = Worthune()

result = client.run("relocation", {
    "currentSalary": 95000, "newSalary": 108000,
    "currentMonthlyExpenses": 4200, "newMonthlyExpenses": 4900,
    "movingCosts": 6000, "currentSavings": 40000,
    "annualReturn": 0.07, "yearsHorizon": 10,
})

result["outputs"]["breakEvenMonths"]  # 16
result["specVersion"]                 # pinned contract version
result["facts"]                       # IRS/SSA constants used, with sources
result["sentinels"]                   # special values, explained
verify_record(result)                 # True — audit fingerprint checks out
```

## API

- `client.list_models()` — catalog with spec versions
- `client.get_contract(model)` — machine-readable inputs/domains/sentinels
- `client.get_spec(model)` — the full published spec (markdown)
- `client.run(model, inputs)` — run; validation failures return `{"ok": False, "errors": [...]}` instead of raising
- `client.get_eval_dataset(model)` — 250 verified input/expected-output pairs, the exact cases Worthune's dual-implementation CI verifies (ground truth for financial AI testing)
- `client.get_facts()` — the sourced IRS/SSA constants registry
- `verify_record(response)` — recompute the SHA-256 decision record to prove where numbers came from (byte-exact ECMAScript-compatible canonical JSON)

Retirement, FIRE, rent vs. buy, refinancing, equity comp (RSUs), debt payoff,
Social Security timing, 529 plans, estate planning, and more — the
[full catalog](https://worthune.com/models) lists all 27.

Fair use: 5,000 runs/month per app (a guideline, not a meter) —
[the free tier, in writing](https://worthune.com/pricing).

MIT licensed. The models, specs, and verification harness live behind the API
at [worthune.com](https://worthune.com).
