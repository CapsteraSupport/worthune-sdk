"""Worthune SDK — thin, zero-dependency client for the Worthune Model API.

Verified financial calculation models, each with a published spec and an
independent second implementation that must agree with the first before
anything ships. The catalog grows in packs — list_models() is always the
live list. Docs: https://worthune.com/docs

The SDK is a client only — the models, specs, and verification harness live
behind the API. Free with attribution: https://worthune.com/pricing
"""

from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.request
from decimal import Decimal
from typing import Any

__version__ = "0.2.0"
__all__ = [
    "Worthune",
    "WorthuneError",
    "canonical_json",
    "verify_record",
]

_DEFAULT_BASE_URL = "https://worthune.com"
_USER_AGENT = f"worthune-python/{__version__}"


class WorthuneError(Exception):
    """Raised for transport failures and non-validation HTTP errors."""

    def __init__(self, message: str, status: int | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


class Worthune:
    """Client for the Worthune Model API.

    >>> client = Worthune()
    >>> result = client.run("relocation", {"currentSalary": 95000, ...})
    >>> result["outputs"]["breakEvenMonths"]
    """

    def __init__(
        self,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
        api_key: str | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        # Optional wk_… key: the free sample runs without one; paid models
        # and all household resources require it.
        self.api_key = api_key

    # ── transport ────────────────────────────────────────────────────────────
    def _request(
        self,
        path: str,
        payload: dict[str, Any] | None = None,
        method: str | None = None,
    ) -> bytes:
        url = f"{self.base_url}{path}"
        data = None
        headers = {"user-agent": _USER_AGENT, "accept": "*/*"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["content-type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return res.read()
        except urllib.error.HTTPError as err:
            body_bytes = err.read()
            # 400s carry the structured validation envelope callers want;
            # everything else (404, 429 burst backstop, 5xx) raises.
            # Structured envelopes the caller wants to branch on: validation
            # (400/422), not-found (404), and version conflicts (409).
            if err.code in (400, 404, 409, 422):
                return body_bytes
            body: Any = None
            try:
                body = json.loads(body_bytes)
            except ValueError:
                pass
            raise WorthuneError(
                f"{'POST' if payload is not None else 'GET'} {path} -> {err.code}",
                status=err.code,
                body=body,
            ) from err
        except urllib.error.URLError as err:
            raise WorthuneError(f"request to {url} failed: {err.reason}") from err

    def _get_json(self, path: str) -> Any:
        return json.loads(self._request(path))

    # ── API surface ──────────────────────────────────────────────────────────
    def list_models(self) -> list[dict[str, Any]]:
        """Catalog of all models with spec versions."""
        return self._get_json("/api/v1/models")["models"]

    def get_contract(self, model: str) -> dict[str, Any]:
        """Machine-readable contract: inputs, domains, sentinels, spec version."""
        return self._get_json(f"/api/v1/models/{model}")

    def get_spec(self, model: str) -> str:
        """The full published spec, as markdown."""
        return self._request(f"/api/v1/models/{model}/spec").decode("utf-8")

    # ── Household resources ──────────────────────────────────────────────────
    # Stateful, organization-owned households (docs/household-schema-spec.md):
    # create once, keep updated, project on demand. Requires an api_key on
    # billing-enforced deployments.

    def create_household(
        self, household: dict[str, Any], label: str | None = None
    ) -> dict[str, Any]:
        """Create a household from a household-schema document."""
        payload: dict[str, Any] = {"household": household}
        if label is not None:
            payload["label"] = label
        return json.loads(self._request("/api/v1/households", payload=payload))

    def list_households(self) -> dict[str, Any]:
        """The organization's households (metadata only)."""
        return self._get_json("/api/v1/households")

    def get_household(self, household_id: int) -> dict[str, Any]:
        """One household: metadata plus the stored document."""
        return self._get_json(f"/api/v1/households/{household_id}")

    def replace_household(
        self,
        household_id: int,
        household: dict[str, Any],
        expected_version: int | None = None,
        label: str | None = None,
    ) -> dict[str, Any]:
        """Full-document replace with optimistic concurrency.

        Pass ``expected_version`` (from :meth:`get_household`) and a stale
        write loses cleanly with a 409 envelope naming the current version.
        """
        payload: dict[str, Any] = {"household": household}
        if expected_version is not None:
            payload["expectedVersion"] = expected_version
        if label is not None:
            payload["label"] = label
        return json.loads(
            self._request(f"/api/v1/households/{household_id}", payload=payload, method="PUT")
        )

    def archive_household(self, household_id: int) -> dict[str, Any]:
        """Archive (never delete): the row stays readable and leaves the meter."""
        return json.loads(
            self._request(f"/api/v1/households/{household_id}", method="DELETE")
        )

    def project_household(
        self,
        household_id: int,
        horizon: dict[str, int],
        assumptions: dict[str, float] | None = None,
        profile: dict[str, str] | None = None,
        monte_carlo: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Run the deterministic projection (and optional seeded Monte Carlo).

        The response names its ``assumptionsSource`` — a default is never
        silent — and ``projection.assumptionsApplied`` lists every
        simplification that fired.
        """
        payload: dict[str, Any] = {"horizon": horizon}
        if assumptions is not None:
            payload["assumptions"] = assumptions
        if profile is not None:
            payload["profile"] = profile
        if monte_carlo is not None:
            payload["monteCarlo"] = monte_carlo
        return json.loads(
            self._request(f"/api/v1/households/{household_id}/project", payload=payload)
        )

    # ── Webhooks ─────────────────────────────────────────────────────────────

    def create_webhook_endpoint(self, url: str, events: list[str]) -> dict[str, Any]:
        """Register an HTTPS endpoint for household events.

        The signing secret is returned ONCE — store it immediately.
        """
        return json.loads(
            self._request("/api/v1/webhooks", payload={"url": url, "events": events})
        )

    def list_webhook_endpoints(self) -> dict[str, Any]:
        return self._get_json("/api/v1/webhooks")

    def delete_webhook_endpoint(self, endpoint_id: int) -> dict[str, Any]:
        return json.loads(self._request(f"/api/v1/webhooks/{endpoint_id}", method="DELETE"))

    def run(self, model: str, inputs: dict[str, Any]) -> dict[str, Any]:
        """Run a model.

        Returns the full envelope — outputs, sentinels, assumptions, cited
        facts, and the decision record. Validation failures return
        ``{"ok": False, "errors": [...]}`` rather than raising; network and
        server errors raise :class:`WorthuneError`.
        """
        return json.loads(self._request(f"/api/v1/models/{model}", payload=inputs))

    def list_evals(self) -> dict[str, Any]:
        """Index of verified eval datasets."""
        return self._get_json("/api/v1/evals")

    def get_eval_dataset(self, model: str) -> dict[str, Any]:
        """One eval dataset: ``{"meta": {...}, "cases": [...]}``.

        250 deterministic input/expected-output pairs — the exact cases
        Worthune's dual-implementation CI harness verifies.
        """
        lines = self._request(f"/api/v1/evals/{model}").decode("utf-8").strip().split("\n")
        return {
            "meta": json.loads(lines[0]),
            "cases": [json.loads(line) for line in lines[1:]],
        }

    def get_facts(self) -> list[dict[str, Any]]:
        """The sourced-constants registry (IRS limits, brackets, SSA factors)."""
        return self._get_json("/api/v1/facts")["facts"]


# ── Decision-record verification ─────────────────────────────────────────────
# Every successful run carries record.sha256 — SHA-256 over the canonical JSON
# of {model, specVersion, inputs, outputs} with object keys sorted recursively
# and numbers rendered exactly as ECMAScript renders them (the server is
# JavaScript). Recompute it any time to prove a stored response's numbers came
# from that spec version with those inputs, unaltered.


def _js_number_repr(value: float) -> str:
    """Render a float exactly as ECMAScript Number::toString(10) would.

    Python and JavaScript both choose shortest round-trip digits, but format
    them differently (e.g. Python ``5e-05`` vs JS ``0.00005``; Python
    ``1e+21`` matches JS, but Python switches to exponent form at different
    thresholds). JSON numbers parsed from API responses hash correctly only
    if re-rendered the way the server rendered them.
    """
    if value != value or value in (float("inf"), float("-inf")):
        raise ValueError("non-finite numbers cannot appear in JSON")
    if value == 0:
        return "0"  # covers -0.0, which JS renders as "0"
    sign = "-" if value < 0 else ""
    d = Decimal(repr(abs(value))).normalize()
    digit_tuple, exp = d.as_tuple()[1], int(d.as_tuple()[2])
    digits = "".join(str(x) for x in digit_tuple)
    k = len(digits)
    n = exp + k  # value = 0.<digits> * 10^n
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    # exponential form; JS writes e+21 / e-7 (no zero padding)
    e = n - 1
    e_str = f"e+{e}" if e >= 0 else f"e-{-e}"
    if k == 1:
        return sign + digits + e_str
    return sign + digits[0] + "." + digits[1:] + e_str


def canonical_json(value: Any) -> str:
    """Serialize with object keys sorted recursively, no whitespace,
    JS-compatible number rendering."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return _js_number_repr(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    if isinstance(value, dict):
        items = sorted(value.items(), key=lambda kv: kv[0])
        return "{" + ",".join(
            f"{json.dumps(k, ensure_ascii=False)}:{canonical_json(v)}" for k, v in items
        ) + "}"
    raise TypeError(f"unsupported type in canonical JSON: {type(value)!r}")


def verify_record(response: dict[str, Any]) -> bool:
    """Recompute a response's decision-record hash and compare."""
    canonical = canonical_json(
        {
            "model": response["model"],
            "specVersion": response["specVersion"],
            "inputs": response["inputs"],
            "outputs": response["outputs"],
        }
    )
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return digest == response["record"]["sha256"]
