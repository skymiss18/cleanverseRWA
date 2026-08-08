import assert from "node:assert/strict";
import test from "node:test";

import { CleanverseClient } from "../src/lib/cleanverse/client";
import { buildEncryptedEnvelope, decryptCleanversePayload, encryptCleanversePayload } from "../src/lib/cleanverse/crypto";
import { CleanverseBusinessError, CleanverseHttpError } from "../src/lib/cleanverse/errors";

const KEY = Buffer.from("0123456789abcdef0123456789abcdef", "utf8").toString("base64");

test("Cleanverse AES-CBC encryption is deterministic and round-trips Unicode JSON", () => {
  const payload = { chain: "monad", token_name: "Nexus 绿色债券", min_tier: 30 };
  const ciphertext = encryptCleanversePayload(payload, KEY);

  assert.equal(ciphertext, "MjNV/qIwF1QK06EPlQc901hdn4Z0R712xnsduVzbriEaRt4yr/NdH0ArYWgBFj0Y1vQJdp3RNg7S3pq0Y5OEiKv7JUtF8BkPdT46vC+go6M=");
  assert.deepEqual(decryptCleanversePayload(ciphertext, KEY), payload);
  assert.deepEqual(buildEncryptedEnvelope(payload, KEY), { data: ciphertext });
});

test("Cleanverse encryption rejects malformed keys and ciphertext", () => {
  assert.throws(() => encryptCleanversePayload({}, "not-base64"), /Base64-encoded AES key/);
  assert.throws(() => decryptCleanversePayload("invalid", KEY), /ciphertext/);
});

test("Cleanverse client sends encrypted writes with required headers", async () => {
  let captured: { url?: string; init?: RequestInit } = {};
  const fetchMock: typeof fetch = async (url, init) => {
    captured = { url: String(url), init };
    return Response.json({ code: "0000", message: "success", data: { requestId: "REQ-1" } });
  };
  const client = new CleanverseClient({
    baseUrl: "https://uatapi.cleanverse.com/api/cooperate/",
    apiId: "test-api-id",
    apiKey: KEY,
    timeoutMs: 1_000,
  }, fetchMock);

  const result = await client.request<{ requestId: string }>("/atoken/launch", {
    method: "POST",
    body: { chain: "monad" },
    encrypted: true,
    requestId: "00000000-0000-4000-8000-000000000001",
  });

  assert.equal(result.data?.requestId, "REQ-1");
  assert.equal(captured.url, "https://uatapi.cleanverse.com/api/cooperate/atoken/launch");
  const headers = captured.init?.headers as Record<string, string>;
  assert.equal(headers["api-id"], "test-api-id");
  assert.equal(headers["X-Request-ID"], "00000000-0000-4000-8000-000000000001");
  const envelope = JSON.parse(String(captured.init?.body)) as { data: string };
  assert.deepEqual(decryptCleanversePayload(envelope.data, KEY), { chain: "monad" });
});

test("Cleanverse client rejects HTTP and business-level failures", async () => {
  const config = { baseUrl: "https://example.test", apiId: "id", apiKey: KEY, timeoutMs: 1_000 };
  const httpClient = new CleanverseClient(config, async () => new Response("forbidden", { status: 403 }));
  await assert.rejects(() => httpClient.request("query"), CleanverseHttpError);

  const businessClient = new CleanverseClient(config, async () => Response.json({ code: "0002", message: "rule rejected", data: null }));
  await assert.rejects(
    () => businessClient.request("query"),
    (error: unknown) => error instanceof CleanverseBusinessError && error.code === "0002",
  );
});