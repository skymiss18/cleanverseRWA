const CASPER_ACCOUNT_HASH_REGEX = /^(?:account-hash-)?[0-9a-fA-F]{64}$/;
const CASPER_ED25519_PUBLIC_KEY_REGEX = /^01[0-9a-fA-F]{64}$/;
const CASPER_SECP256K1_PUBLIC_KEY_REGEX = /^02[0-9a-fA-F]{66}$/;

export function isCasperAccountHash(value: string): boolean {
  return CASPER_ACCOUNT_HASH_REGEX.test(value.trim());
}

export function normalizeCasperAccountHash(value: string): string {
  const trimmed = value.trim();
  if (!isCasperAccountHash(trimmed)) {
    throw new Error("Casper account-hash must be 64 hex characters, optionally prefixed with account-hash-");
  }
  return trimmed.startsWith("account-hash-") ? trimmed : `account-hash-${trimmed}`;
}

export function isCasperPublicKeyHex(value: string): boolean {
  const trimmed = value.trim();
  return CASPER_ED25519_PUBLIC_KEY_REGEX.test(trimmed) || CASPER_SECP256K1_PUBLIC_KEY_REGEX.test(trimmed);
}

export function isCasperAddressLike(value: string): boolean {
  const trimmed = value.trim();
  return isCasperPublicKeyHex(trimmed) || isCasperAccountHash(trimmed);
}