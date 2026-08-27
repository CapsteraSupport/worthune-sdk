import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalJson, verifyRecord, Worthune, type RunSuccess } from "../src/index";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixture-relocation.json", import.meta.url)), "utf8"),
) as RunSuccess;

describe("decision-record verification (offline, real captured response)", () => {
  it("verifies the fixture's record hash", async () => {
    expect(fixture.ok).toBe(true);
    expect(await verifyRecord(fixture)).toBe(true);
  });

  it("detects tampering", async () => {
    const tampered = {
      ...fixture,
      outputs: { ...fixture.outputs, breakEvenMonths: 1 },
    };
    expect(await verifyRecord(tampered)).toBe(false);
  });

  it("canonicalJson sorts keys recursively and is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 3, y: 4 }], c: 5 } })).toBe(
      '{"a":{"c":5,"d":[2,{"y":4,"z":3}]},"b":1}',
    );
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
});

describe("client construction", () => {
  it("normalizes trailing slashes and accepts a custom fetch", async () => {
    const seen: string[] = [];
    const fake = (async (url: RequestInfo | URL) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ models: [] }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const client = new Worthune({ baseUrl: "https://example.test///", fetch: fake });
    await client.listModels();
    expect(seen[0]).toBe("https://example.test/api/v1/models");
  });

  it("parses eval JSONL into meta + cases", async () => {
    const jsonl =
      JSON.stringify({ dataset: "worthune-evals/fire", model: "fire", specVersion: "1.0.0", count: 2, tolerance: { rel: 1e-9, abs: 1e-6 } }) +
      "\n" +
      JSON.stringify({ id: "fire-0000", inputs: { a: 1 }, expected: { b: 2 } }) +
      "\n" +
      JSON.stringify({ id: "fire-0001", inputs: { a: 3 }, expected: { b: 4 } }) +
      "\n";
    const fake = (async () => new Response(jsonl)) as typeof fetch;
    const client = new Worthune({ baseUrl: "https://example.test", fetch: fake });
    const ds = await client.getEvalDataset("fire");
    expect(ds.meta.model).toBe("fire");
    expect(ds.cases).toHaveLength(2);
    expect(ds.cases[1].id).toBe("fire-0001");
  });
});

describe("api key and household surface", () => {
  const record: { urls: string[]; headers: Array<Record<string, string>>; methods: string[] } = {
    urls: [], headers: [], methods: [],
  };
  const fake = (async (url: RequestInfo | URL, init?: RequestInit) => {
    record.urls.push(String(url));
    record.methods.push(init?.method ?? "GET");
    const h: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { h[k] = v; });
    record.headers.push(h);
    return new Response(JSON.stringify({ ok: true, households: [] }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  it("sends the api key as a bearer header on every request", async () => {
    const client = new Worthune({ baseUrl: "https://example.test", fetch: fake, apiKey: "wk_test123" });
    await client.listHouseholds();
    expect(record.headers.at(-1)?.["authorization"]).toBe("Bearer wk_test123");
  });

  it("shapes household calls: paths, methods, and bodies", async () => {
    const client = new Worthune({ baseUrl: "https://example.test", fetch: fake, apiKey: "wk_test123" });
    await client.createHousehold({ schemaVersion: "0.2.0" }, "The Alvarez family");
    expect(record.urls.at(-1)).toBe("https://example.test/api/v1/households");
    expect(record.methods.at(-1)).toBe("POST");
    await client.replaceHousehold(7, { schemaVersion: "0.2.0" }, { expectedVersion: 3 });
    expect(record.urls.at(-1)).toBe("https://example.test/api/v1/households/7");
    expect(record.methods.at(-1)).toBe("PUT");
    await client.projectHousehold(7, { horizon: { startYear: 2027, years: 30 }, monteCarlo: { seed: 42 } });
    expect(record.urls.at(-1)).toBe("https://example.test/api/v1/households/7/project");
    await client.patchHousehold(7, {
      expectedVersion: 4,
      set: { state: "TX" },
      upsert: { accounts: [{ id: "brokerage", wrapper: "taxable", ownerId: "p", balance: 1 }] },
      remove: { liabilities: ["auto"] },
    });
    expect(record.urls.at(-1)).toBe("https://example.test/api/v1/households/7");
    expect(record.methods.at(-1)).toBe("PATCH");
    await client.decideHousehold(7, {
      strategy: "roth-ladder",
      horizon: { startYear: 2027, years: 25 },
      params: { candidates: [{ annualAmountUsd: 40_000, years: 5 }] },
    });
    expect(record.urls.at(-1)).toBe("https://example.test/api/v1/households/7/decisions");
    expect(record.methods.at(-1)).toBe("POST");
    await client.archiveHousehold(7);
    expect(record.methods.at(-1)).toBe("DELETE");
    await client.createWebhookEndpoint("https://hooks.example.com/w", ["household.computed"]);
    expect(record.urls.at(-1)).toBe("https://example.test/api/v1/webhooks");
  });
});
