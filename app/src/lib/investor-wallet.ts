export function isEthereumAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

export function isInvestorWalletAddress(value: string): boolean {
  return isEthereumAddress(value);
}