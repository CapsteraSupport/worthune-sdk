// ─── Worthune SDK (JavaScript/TypeScript) ────────────────────────────────────
// Thin, zero-dependency client for the Worthune Model API: verified
// financial calculation models, each with a published spec and an independent
// second implementation that must agree with the first before anything
// ships. The catalog grows in packs — listModels() is always the live list.
//
// Docs: https://worthune.com/docs · Free with attribution: worthune.com/pricing
// The SDK is a client only — the models, specs, and verification harness live
// behind the API.

export interface SentinelNote {
  field: string;
  value: number;
  meaning: string;
  triggered: boolean;
}

export interface FactCitation {
  id: string;
  label: string;
  value: number;
  period: string;
  source: string;
}

export interface DecisionRecord {
  /** SHA-256 (hex) over the canonical JSON of the hashed fields. */
  sha256: string;
  fields: ["model", "specVersion", "inputs", "outputs"];
  howToVerify: string;
}

export interface RunSuccess {
  ok: true;
  model: string;
  specVersion: string;
  contractUrl: string;
  specUrl: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  sentinels: SentinelNote[];
  assumptions: string[];
  facts: FactCitation[];
  record: DecisionRecord;
  disclaimer: string;
}

export interface RunFailure {
  ok: false;
  model?: string;
  errors: Array<{ field?: string; message: string }>;
}

export type RunResult = RunSuccess | RunFailure;

export interface ModelListing {
  name: string;
  specVersion: string;
  contractUrl: string;
}

export interface EvalCase {
  id: string;
  inputs: Record<string, unknown>;
  expected: Record<string, unknown>;
}

export interface EvalDataset {
  meta: {
    dataset: string;
    model: string;
    specVersion: string;
    count: number;
    tolerance: { rel: number; abs: number };
    [key: string]: unknown;
  };
  cases: EvalCase[];
}

export interface Fact {
  id: string;
  label: string;
  value: number;
  unit: "USD" | "ratio";
  period: string;
  jurisdiction: string;
  source: { name: string; url?: string };
  verifiedOn: string;
  status: "verified" | "repo-asserted" | "stale-in-use" | "historical";
  notes?: string;
}

export interface WorthuneOptions {
  /** Defaults to https://worthune.com — override for testing. */
  baseUrl?: string;
  /** Custom fetch implementation (defaults to globalThis.fetch). */
  fetch?: typeof fetch;
  /**
   * Worthune API key (wk_…). Optional — the free sample runs without one;
   * paid models and all household resources require it. Sent as an
   * Authorization: Bearer header on every request.
   */
  apiKey?: string;
}

// ── Household resources ──────────────────────────────────────────────────────
// Stateful, organization-owned households (docs/household-schema-spec.md):
// create once, keep updated, project on demand. Documents validate on the
// server (reject, never clamp); replace uses optimistic concurrency.

export interface HouseholdSummary {
  id: number;
  label: string | null;
  schemaVersion: string;
  version: number;
  status: "active" | "archived";
}

export interface ProjectHouseholdRequest {
  horizon: { startYear: number; years: number };
  /** Exactly one of assumptions/profile, or neither for the labeled default. */
  assumptions?: {
    annualReturn: number;
    inflationRate: number;
    defaultIncomeGrowth: number;
    /**
     * Per-wrapper return pins (projection spec v0.5): a wrapper listed here
     * grows at its own rate instead of the blended annualReturn — and stays
     * deterministic under Monte Carlo. Keys are account wrappers
     * (cash, taxable, traditional, roth, hsa, plan529, annuity).
     */
    returnsByWrapper?: Record<string, number>;
  };
  profile?: { id: string; version: string };
  monteCarlo?: {
    seed: number;
    simulations?: number;
    returnVolatility?: number;
    /**
     * Longevity-aware runs (stochastic v0.2): sample adult death years from
     * the NCHS 2024 period life table and report survival-conditioned
     * outcomes. Requires sex ("male" | "female") on every adult member —
     * runs without it are rejected with per-member paths, never defaulted.
     */
    longevity?: boolean;
  };
}

export interface DecideHouseholdRequest {
  strategy:
    | "withdrawal-sequencing"
    | "roth-ladder"
    | "ss-claiming"
    | "asset-location"
    | "tax-loss-harvesting"
    | "annual-gifting"
    | "pension-election";
  horizon: { startYear: number; years: number };
  /** Same resolution as projectHousehold: one of these, or neither for the labeled default. */
  assumptions?: ProjectHouseholdRequest["assumptions"];
  profile?: { id: string; version: string };
  /** Strategy-specific parameters — see decideHousehold's doc comment. */
  params?: Record<string, unknown>;
}

export interface PatchHouseholdRequest {
  /** REQUIRED: the version you read (getHousehold) — deltas against unknown state are refused. */
  expectedVersion: number;
  /** Scalar fields: { filingStatus?, state? } (state: null clears it). */
  set?: Record<string, unknown>;
  /** Collection → entries with ids: replace matching ids, append new ones. */
  upsert?: Record<string, Array<Record<string, unknown>>>;
  /** Collection → ids to remove. */
  remove?: Record<string, string[]>;
  label?: string | null;
}

export class WorthuneError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "WorthuneError";
    this.status = status;
    this.body = body;
  }
}

export class Worthune {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiKey?: string;

  constructor(options: WorthuneOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://worthune.com").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.apiKey = options.apiKey;
    if (!this.fetchImpl) {
      throw new Error("No fetch available — pass one via options.fetch (Node < 18?)");
    }
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (this.apiKey && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${this.apiKey}`);
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok && res.status !== 400) {
      // 400s carry a structured validation envelope the caller wants to see;
      // everything else (404 unknown model, 429 burst backstop, 5xx) throws.
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON error body */
      }
      throw new WorthuneError(`${init?.method ?? "GET"} ${path} → ${res.status}`, res.status, body);
    }
    return res;
  }

  /** Catalog of all models with spec versions. */
  async listModels(): Promise<ModelListing[]> {
    const res = await this.request("/api/v1/models");
    const data = (await res.json()) as { models: ModelListing[] };
    return data.models;
  }

  /** Machine-readable contract: inputs, domains, sentinels, spec version. */
  async getContract(model: string): Promise<Record<string, unknown>> {
    const res = await this.request(`/api/v1/models/${encodeURIComponent(model)}`);
    return (await res.json()) as Record<string, unknown>;
  }

  /** The full published spec, as markdown. */
  async getSpec(model: string): Promise<string> {
    const res = await this.request(`/api/v1/models/${encodeURIComponent(model)}/spec`);
    return res.text();
  }

  /**
   * Run a model. Returns the full envelope — outputs, sentinels, assumptions,
   * cited facts, and the decision record. Validation failures return
   * `{ ok: false, errors }` rather than throwing; network/server errors throw.
   */
  async run(model: string, inputs: Record<string, unknown>): Promise<RunResult> {
    const res = await this.request(`/api/v1/models/${encodeURIComponent(model)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inputs),
    });
    return (await res.json()) as RunResult;
  }

  /** Index of verified eval datasets. */
  async listEvals(): Promise<Record<string, unknown>> {
    const res = await this.request("/api/v1/evals");
    return (await res.json()) as Record<string, unknown>;
  }

  /**
   * One eval dataset: 250 deterministic input/expected-output pairs — the
   * exact cases Worthune's dual-implementation CI harness verifies.
   */
  async getEvalDataset(model: string): Promise<EvalDataset> {
    const res = await this.request(`/api/v1/evals/${encodeURIComponent(model)}`);
    const lines = (await res.text()).trim().split("\n");
    const meta = JSON.parse(lines[0]) as EvalDataset["meta"];
    const cases = lines.slice(1).map((l) => JSON.parse(l) as EvalCase);
    return { meta, cases };
  }

  /** The sourced-constants registry (IRS limits, brackets, SSA factors). */
  async getFacts(): Promise<Fact[]> {
    const res = await this.request("/api/v1/facts");
    const data = (await res.json()) as { facts: Fact[] };
    return data.facts;
  }

  // ── Household resources ────────────────────────────────────────────────────

  private async json(path: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
    try {
      const res = await this.request(path, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      // Household/webhook routes answer 404 (not found), 409 (version
      // conflict), and 422 (validation) with structured envelopes the caller
      // wants to branch on — return those; rethrow everything else.
      if (
        err instanceof WorthuneError &&
        (err.status === 404 || err.status === 409 || err.status === 422) &&
        err.body !== null &&
        typeof err.body === "object"
      ) {
        return err.body as Record<string, unknown>;
      }
      throw err;
    }
  }

  /** Create a household from a household-schema document. 422-style validation errors come back in the envelope. */
  async createHousehold(household: Record<string, unknown>, label?: string): Promise<Record<string, unknown>> {
    return this.json("/api/v1/households", "POST", { household, ...(label === undefined ? {} : { label }) });
  }

  /** List the organization's households (metadata only). */
  async listHouseholds(): Promise<Record<string, unknown>> {
    return this.json("/api/v1/households", "GET");
  }

  /** One household: metadata plus the stored document. */
  async getHousehold(id: number): Promise<Record<string, unknown>> {
    return this.json(`/api/v1/households/${id}`, "GET");
  }

  /**
   * Full-document replace. Pass expectedVersion (from getHousehold) and a
   * stale write loses cleanly with a 409 naming the current version.
   */
  async replaceHousehold(
    id: number,
    household: Record<string, unknown>,
    opts: { expectedVersion?: number; label?: string | null } = {},
  ): Promise<Record<string, unknown>> {
    return this.json(`/api/v1/households/${id}`, "PUT", { household, ...opts });
  }

  /**
   * Collection-level delta without resending the whole document: set
   * scalars, upsert entries by id, remove entries by id. expectedVersion
   * is required; the server validates the MERGED result in full, so a
   * delta can never produce an invalid household. The response echoes a
   * `changed` summary of every path the delta touched.
   */
  async patchHousehold(id: number, request: PatchHouseholdRequest): Promise<Record<string, unknown>> {
    return this.json(`/api/v1/households/${id}`, "PATCH", request);
  }

  /** Archive (never delete): the row stays readable and leaves the meter. */
  async archiveHousehold(id: number): Promise<Record<string, unknown>> {
    return this.json(`/api/v1/households/${id}`, "DELETE");
  }

  /**
   * Run the deterministic projection (and optional seeded Monte Carlo) on a
   * stored household. The response names its assumptionsSource — a default
   * is never silent — and projection.assumptionsApplied lists every
   * simplification that fired.
   */
  async projectHousehold(id: number, request: ProjectHouseholdRequest): Promise<Record<string, unknown>> {
    return this.json(`/api/v1/households/${id}/project`, "POST", request);
  }

  /**
   * Run a Household Coordination Engine strategy on a stored household and
   * get back a ranked decision object with evidence records. Strategies and
   * their params: "withdrawal-sequencing" (none); "roth-ladder"
   * ({ candidates: [{ annualAmountUsd, years }] } — v0.2 ranks net of
   * estimated IRMAA Part B surcharges, approximations stated on the
   * decision); "ss-claiming" ({ candidateAges?: { memberId: [ages] } });
   * "asset-location" ({ taxRates, characteristics } or { taxRates,
   * illustrativeCharacteristics: true } — the illustrative set is labeled
   * not-a-recommendation and never applied silently);
   * "tax-loss-harvesting" ({ ordinaryMarginalRatePct, longTermRatePct?,
   * realizedGains? }); "annual-gifting" ({ doneeCount, years });
   * "pension-election" ({ ownerId, startAge, discountRatePct — required,
   * the caller's view — and options: [{ kind: "single-life" |
   * "joint-survivor" | "lump-sum", … }]; EPVs from the NCHS life table,
   * adults need sex).
   */
  async decideHousehold(id: number, request: DecideHouseholdRequest): Promise<Record<string, unknown>> {
    return this.json(`/api/v1/households/${id}/decisions`, "POST", request);
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  /** Register an HTTPS endpoint for household events. The signing secret is returned ONCE. */
  async createWebhookEndpoint(url: string, events: string[]): Promise<Record<string, unknown>> {
    return this.json("/api/v1/webhooks", "POST", { url, events });
  }

  async listWebhookEndpoints(): Promise<Record<string, unknown>> {
    return this.json("/api/v1/webhooks", "GET");
  }

  async deleteWebhookEndpoint(id: number): Promise<Record<string, unknown>> {
    return this.json(`/api/v1/webhooks/${id}`, "DELETE");
  }
}

// ─── Decision-record verification ────────────────────────────────────────────
// Every successful run carries record.sha256 — a hash over the canonical JSON
// of {model, specVersion, inputs, outputs} with object keys sorted
// recursively. Recompute it any time to prove a stored response's numbers
// came from that spec version with those inputs, unaltered.

/** Serialize with object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Recompute a response's decision-record hash and compare. Works in Node 18+
 * and browsers (Web Crypto).
 */
export async function verifyRecord(response: RunSuccess): Promise<boolean> {
  const canonical = canonicalJson({
    model: response.model,
    specVersion: response.specVersion,
    inputs: response.inputs,
    outputs: response.outputs,
  });
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex === response.record.sha256;
}
