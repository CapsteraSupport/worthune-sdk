# Worthune SDK quickstart (Python 3.9+).
#   pip install worthune
#   python python-quickstart.py
from worthune import Worthune, verify_record

client = Worthune()

# 1. Run a verified model — no keys required.
result = client.run(
    "relocation",
    {
        "currentSalary": 95000,
        "newSalary": 108000,
        "currentMonthlyExpenses": 4200,
        "newMonthlyExpenses": 4900,
        "movingCosts": 6000,
        "currentSavings": 40000,
        "annualReturn": 0.07,
        "yearsHorizon": 10,
    },
)

if not result["ok"]:
    raise SystemExit(f"validation failed: {result['errors']}")

print("break-even months:", result["outputs"]["breakEvenMonths"])
print("spec version:", result["specVersion"])
print("assumptions:", result["assumptions"])

# 2. Verify the decision record — proves these numbers came from this spec
#    version with these inputs, unaltered. Store result["record"] with
#    anything you build on the outputs.
print("record verifies:", verify_record(result))

# 3. Ground truth for your own eval harness: the exact cases Worthune's
#    dual-implementation CI verifies.
dataset = client.get_eval_dataset("fire")
print(f"eval dataset: {dataset['meta']['count']} cases @ spec v{dataset['meta']['specVersion']}")
