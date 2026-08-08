import {
  decodeEventLog,
  erc20Abi,
  getAddress,
  isAddress,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";

export type SubscriptionPaymentConfig = {
  treasuryAddress: Address;
  minimumConfirmations: number;
};

export type PaymentVerification =
  | { ok: true; confirmations: number; blockNumber: bigint }
  | { ok: false; pending: boolean; reason: string; confirmations?: number };

export function subscriptionPaymentConfigFromEnv(): SubscriptionPaymentConfig {
  const treasuryAddress = process.env.SUBSCRIPTION_TREASURY_ADDRESS?.trim() ?? "";
  const minimumConfirmations = Number(process.env.SUBSCRIPTION_PAYMENT_CONFIRMATIONS ?? 1);

  if (!isAddress(treasuryAddress)) throw new Error("SUBSCRIPTION_TREASURY_ADDRESS is not configured with a valid address");
  if (!Number.isInteger(minimumConfirmations) || minimumConfirmations < 1) {
    throw new Error("SUBSCRIPTION_PAYMENT_CONFIRMATIONS must be a positive integer");
  }

  return {
    treasuryAddress: getAddress(treasuryAddress),
    minimumConfirmations,
  };
}

export async function verifyNativeSubscriptionPayment(input: {
  client: Pick<PublicClient, "getTransaction" | "getTransactionReceipt" | "getBlockNumber">;
  transactionHash: Hash;
  payerAddress: Address;
  treasuryAddress: Address;
  expectedAmount: bigint;
  minimumConfirmations: number;
}): Promise<PaymentVerification> {
  let receipt;
  let transaction;
  try {
    [transaction, receipt] = await Promise.all([
      input.client.getTransaction({ hash: input.transactionHash }),
      input.client.getTransactionReceipt({ hash: input.transactionHash }),
    ]);
  } catch {
    return { ok: false, pending: true, reason: "ETH transaction is not indexed by the Ethereum RPC yet" };
  }

  if (receipt.status !== "success") {
    return { ok: false, pending: false, reason: "ETH transaction reverted" };
  }
  if (transaction.from.toLowerCase() !== input.payerAddress.toLowerCase()) {
    return { ok: false, pending: false, reason: "ETH transaction sender does not match the subscribing wallet" };
  }
  if (transaction.to?.toLowerCase() !== input.treasuryAddress.toLowerCase()) {
    return { ok: false, pending: false, reason: "ETH transaction recipient does not match the subscription treasury" };
  }
  if (transaction.value !== input.expectedAmount) {
    return { ok: false, pending: false, reason: "ETH transaction value does not match the subscription amount" };
  }

  const latestBlock = await input.client.getBlockNumber();
  const confirmations = Number(latestBlock - receipt.blockNumber + 1n);
  if (confirmations < input.minimumConfirmations) {
    return {
      ok: false,
      pending: true,
      confirmations,
      reason: `Waiting for ETH payment confirmations (${confirmations}/${input.minimumConfirmations})`,
    };
  }

  return { ok: true, confirmations, blockNumber: receipt.blockNumber };
}

export async function verifyATokenMint(input: {
  client: Pick<PublicClient, "getTransactionReceipt" | "getBlockNumber">;
  transactionHash: Hash;
  tokenAddress: Address;
  adminAddress: Address;
  recipientAddress: Address;
  expectedAmount: bigint;
  minimumConfirmations: number;
}): Promise<PaymentVerification> {
  let receipt;
  try {
    receipt = await input.client.getTransactionReceipt({ hash: input.transactionHash });
  } catch {
    return { ok: false, pending: true, reason: "A-Token mint transaction is not indexed by the Ethereum RPC yet" };
  }
  if (receipt.status !== "success") return { ok: false, pending: false, reason: "A-Token mint transaction reverted" };
  if (receipt.from.toLowerCase() !== input.adminAddress.toLowerCase()) {
    return { ok: false, pending: false, reason: "Mint transaction sender is not the configured A-Token administrator" };
  }

  const zeroAddress = "0x0000000000000000000000000000000000000000";
  const matchingMint = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== input.tokenAddress.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics });
      return decoded.args.from.toLowerCase() === zeroAddress
        && decoded.args.to.toLowerCase() === input.recipientAddress.toLowerCase()
        && decoded.args.value === input.expectedAmount;
    } catch {
      return false;
    }
  });
  if (!matchingMint) return { ok: false, pending: false, reason: "Transaction does not contain the required A-Token mint event" };

  const latestBlock = await input.client.getBlockNumber();
  const confirmations = Number(latestBlock - receipt.blockNumber + 1n);
  if (confirmations < input.minimumConfirmations) {
    return { ok: false, pending: true, confirmations, reason: `Waiting for A-Token mint confirmations (${confirmations}/${input.minimumConfirmations})` };
  }
  return { ok: true, confirmations, blockNumber: receipt.blockNumber };
}