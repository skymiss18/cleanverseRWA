import { randomUUID } from "node:crypto";

import { buildEncryptedEnvelope } from "./crypto";
import {
  CleanverseBusinessError,
  CleanverseConfigurationError,
  CleanverseHttpError,
} from "./errors";
import type {
  CleanverseClientConfig,
  CleanverseEnvelope,
  CleanverseRequestOptions,
} from "./types";

type Fetch = typeof fetch;

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

export function cleanverseConfigFromEnv(): CleanverseClientConfig {
  const baseUrl = process.env.CLEANVERSE_BASE_URL?.trim() || "https://uatapi.cleanverse.com/api/cooperate";
  const apiId = process.env.CLEANVERSE_API_ID?.trim() || "";
  const apiKey = process.env.CLEANVERSE_API_KEY?.trim() || "";
  const timeoutMs = Number(process.env.CLEANVERSE_REQUEST_TIMEOUT_MS ?? 15_000);

  if (!apiId) throw new CleanverseConfigurationError("CLEANVERSE_API_ID is not configured");
  if (!apiKey) throw new CleanverseConfigurationError("CLEANVERSE_API_KEY is not configured");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new CleanverseConfigurationError("CLEANVERSE_REQUEST_TIMEOUT_MS must be a positive number");
  }

  return { baseUrl: cleanBaseUrl(baseUrl), apiId, apiKey, timeoutMs };
}

export class CleanverseClient {
  constructor(
    private readonly config: CleanverseClientConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async request<T>(path: string, options: CleanverseRequestOptions = {}): Promise<CleanverseEnvelope<T>> {
    const requestId = options.requestId ?? randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const method = options.method ?? (options.body === undefined ? "GET" : "POST");
    const body = options.body === undefined
      ? undefined
      : JSON.stringify(options.encrypted
        ? buildEncryptedEnvelope(options.body, this.config.apiKey)
        : options.body);

    try {
      const response = await this.fetchImpl(`${cleanBaseUrl(this.config.baseUrl)}/${path.replace(/^\/+/, "")}`, {
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-id": this.config.apiId,
          "X-Request-ID": requestId,
        },
        body,
        signal: options.signal ?? controller.signal,
      });

      if (!response.ok) {
        throw new CleanverseHttpError(`Cleanverse request failed with HTTP ${response.status}`, response.status, requestId);
      }

      const envelope = await response.json() as CleanverseEnvelope<T>;
      if (!envelope || typeof envelope.code !== "string" || typeof envelope.message !== "string") {
        throw new CleanverseHttpError("Cleanverse returned an invalid response envelope", response.status, requestId);
      }
      if (envelope.code !== "0000") {
        throw new CleanverseBusinessError(envelope.message || "Cleanverse business request failed", envelope.code, requestId, envelope.data);
      }
      return envelope;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function getCleanverseClient() {
  return new CleanverseClient(cleanverseConfigFromEnv());
}