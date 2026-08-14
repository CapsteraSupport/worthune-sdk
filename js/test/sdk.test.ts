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
