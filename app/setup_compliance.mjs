// One-time setup: register investor in IdentityRegistry + submit HIBT compliance score
import { createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, parseAbiParameters, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const mantleTestnet = defineChain({
  id: 5003,
  name: "Mantle Sepolia Testnet",
  nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.sepolia.mantle.xyz"] } },
});

const PRIVATE_KEY    = "9c1091211f1fa62cb04ed384d7e27f9f7a2370c9a549c213b75b96fcde983cf7";
const REGISTRY_ADDR  = "0x47e231d6b090C2bBFF760a741687aFa99ebe3031";
const ORACLE_ADDR    = "0xe9B84c856d4D0c6bE37D75E6e8fdb7f3C75DcAFD";
const INVESTOR_ADDR  = "0xb1B70643589838F8febE3314ec95C56d22aef1C5";
const ASSET_NAME     = "Harbour Infrastructure Bond Token";

const REGISTRY_ABI = [
  {
    inputs: [
      { name: "investor",    type: "address" },
      { name: "isVerified",  type: "bool"    },
      { name: "amlClear",    type: "bool"    },
      { name: "jurisdiction",type: "bytes32" },
      { name: "kycExpiry",   type: "uint64"  },
    ],
    name: "upsertInvestor",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "investor", type: "address" }],
    name: "isEligible",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
];

const ORACLE_ABI = [
  {
    inputs: [
      { name: "assetId",    type: "bytes32" },
      { name: "score",      type: "uint8"   },
      { name: "reportHash", type: "bytes32" },
    ],
    name: "submitScore",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "assetId", type: "bytes32" }],
    name: "getScore",
    outputs: [
      { name: "score",      type: "uint8"   },
      { name: "updatedAt",  type: "uint64"  },
      { name: "reportHash", type: "bytes32" },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const assetId = keccak256(encodeAbiParameters(parseAbiParameters("string"), [ASSET_NAME]));
const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);
const publicClient  = createPublicClient({ chain: mantleTestnet, transport: http() });
const walletClient  = createWalletClient({ account, chain: mantleTestnet, transport: http() });

// ── 1. Check & register investor ──────────────────────────────────────────────
const eligible = await publicClient.readContract({
  address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: "isEligible", args: [INVESTOR_ADDR],
});
console.log(`Investor ${INVESTOR_ADDR} isEligible: ${eligible}`);

if (!eligible) {
  console.log("Registering investor in IdentityRegistry...");
  const kycExpiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 3600); // 1 year
  const jurisdiction = keccak256(encodeAbiParameters(parseAbiParameters("string"), ["SG"]));
  const h = await walletClient.writeContract({
    address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: "upsertInvestor",
    args: [INVESTOR_ADDR, true, true, jurisdiction, kycExpiry],
  });
  console.log("tx:", h);
  await publicClient.waitForTransactionReceipt({ hash: h });
  console.log("✅ Investor registered");
} else {
  console.log("✅ Investor already eligible");
}

// ── 2. Check & submit asset compliance score ──────────────────────────────────
const scoreInfo = await publicClient.readContract({
  address: ORACLE_ADDR, abi: ORACLE_ABI, functionName: "getScore", args: [assetId],
});
console.log(`\nAsset score: ${scoreInfo[0]} (updatedAt: ${scoreInfo[1]})`);

if (scoreInfo[0] < 70) {
  console.log("Submitting compliance score 85 for HIBT asset...");
  const reportHash = keccak256(encodeAbiParameters(parseAbiParameters("string"), ["HIBT-2026-B-AI-REPORT"]));
  const h = await walletClient.writeContract({
    address: ORACLE_ADDR, abi: ORACLE_ABI, functionName: "submitScore",
    args: [assetId, 85, reportHash],
  });
  console.log("tx:", h);
  await publicClient.waitForTransactionReceipt({ hash: h });
  console.log("✅ Compliance score submitted (85/100)");
} else {
  console.log("✅ Asset already compliant");
}

console.log("\nAll compliance prerequisites are set. mintForAsset should now succeed.");
