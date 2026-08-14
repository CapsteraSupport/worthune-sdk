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

  constructor(options: WorthuneOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://worthune.com").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error("No fetch available — pass one via options.fetch (Node < 18?)");
    }
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
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
