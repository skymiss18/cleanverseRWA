import { createCipheriv, createDecipheriv } from "node:crypto";

import { CleanverseConfigurationError } from "./errors";

const ZERO_IV = Buffer.alloc(16);

function decodeAesKey(base64Key: string) {
  const normalized = base64Key.trim();
  if (!normalized) {
    throw new CleanverseConfigurationError("CLEANVERSE_API_KEY is not configured");
  }

  const key = Buffer.from(normalized, "base64");
  if (![16, 24, 32].includes(key.length) || key.toString("base64").replace(/=+$/, "") !== normalized.replace(/=+$/, "")) {
    throw new CleanverseConfigurationError("CLEANVERSE_API_KEY must be a valid Base64-encoded AES key");
  }
  return key;
}

function algorithmFor(key: Buffer) {
  return `aes-${key.length * 8}-cbc`;
}

export function encryptCleanversePayload(payload: unknown, base64Key: string) {
  const key = decodeAesKey(base64Key);
  const cipher = createCipheriv(algorithmFor(key), key, ZERO_IV);
  const plaintext = JSON.stringify(payload);
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
}

export function decryptCleanversePayload<T>(ciphertext: string, base64Key: string): T {
  const key = decodeAesKey(base64Key);
  const encrypted = Buffer.from(ciphertext, "base64");
  if (!ciphertext.trim() || encrypted.length === 0 || encrypted.length % 16 !== 0) {
    throw new Error("Cleanverse ciphertext must be non-empty Base64 AES-CBC data");
  }
  const decipher = createDecipheriv(algorithmFor(key), key, ZERO_IV);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as T;
}

export function buildEncryptedEnvelope(payload: unknown, base64Key: string) {
  return { data: encryptCleanversePayload(payload, base64Key) };
}