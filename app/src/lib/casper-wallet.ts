export type CasperSignatureResponse =
  | { cancelled: true }
  | { cancelled: false; signatureHex: string; signature: Uint8Array };

export interface CasperWalletProvider {
  requestConnection: () => Promise<boolean>;
  requestSwitchAccount: () => Promise<boolean>;
  getActivePublicKey: () => Promise<string>;
  sign: (transactionJson: string, signingPublicKeyHex: string) => Promise<CasperSignatureResponse>;
  disconnectFromSite: () => Promise<boolean>;
  isConnected: () => Promise<boolean>;
  getVersion: () => Promise<string>;
}

// window.CasperWalletProvider is a factory function — must be called as window.CasperWalletProvider()
declare global {
  interface Window {
    CasperWalletProvider?: () => CasperWalletProvider;
  }
}

export function getCasperWalletProvider(): CasperWalletProvider {
  if (typeof window === "undefined" || !window.CasperWalletProvider) {
    throw new Error("Casper Wallet extension not found. Install Casper Wallet and refresh this page.");
  }
  return window.CasperWalletProvider();
}

export async function connectCasperWallet() {
  const provider = getCasperWalletProvider();
  await provider.requestConnection();
  const publicKey = await provider.getActivePublicKey();
  if (!publicKey) {
    throw new Error("Casper Wallet did not return an active public key");
  }
  return { provider, publicKey };
}

export async function signCasperDeploy(deployJson: unknown, signingPublicKeyHex: string) {
  const provider = getCasperWalletProvider();
  const response = await provider.sign(JSON.stringify(deployJson), signingPublicKeyHex);
  if (response.cancelled) {
    throw new Error("Casper Wallet signing was cancelled");
  }
  if (!response.signatureHex && !response.signature) {
    throw new Error("Casper Wallet did not return a signature");
  }
  return response;
}
