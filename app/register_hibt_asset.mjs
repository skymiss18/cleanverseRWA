// One-time script: register HIBT asset on the already-deployed HarbourRWAToken contract
import { createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, parseAbiParameters, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const mantleTestnet = defineChain({
  id: 5003,
  name: "Mantle Sepolia Testnet",
  nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.sepolia.mantle.xyz"] } },
});

const PRIVATE_KEY  = "9c1091211f1fa62cb04ed384d7e27f9f7a2370c9a549c213b75b96fcde983cf7";
const TOKEN_ADDR   = "0x5b92134F804a766C566Ab253F40642F28E9b3007";
const ASSET_NAME   = "Harbour Infrastructure Bond Token";

const REGISTER_ABI = [
  {
    inputs: [
      { name: "assetId",              type: "bytes32" },
      { name: "assetType",            type: "uint8"   },
      { name: "assetName",            type: "string"  },
      { name: "maturityDate",         type: "uint256" },
      { name: "couponBps",            type: "uint256" },
      { name: "prospectusCommitment", type: "bytes32" },
    ],
    name: "registerAsset",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "assetId", type: "bytes32" }],
    name: "assets",
    outputs: [
      { name: "approved",             type: "bool"    },
      { name: "assetType",            type: "uint8"   },
      { name: "name",                 type: "string"  },
      { name: "maturityDate",         type: "uint256" },
      { name: "couponBps",            type: "uint256" },
      { name: "prospectusCommitment", type: "bytes32" },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const assetId = keccak256(encodeAbiParameters(parseAbiParameters("string"), [ASSET_NAME]));
console.log("assetId:", assetId);

const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);
const publicClient = createPublicClient({ chain: mantleTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: mantleTestnet, transport: http() });

// Check if already registered
const info = await publicClient.readContract({
  address: TOKEN_ADDR,
  abi: REGISTER_ABI,
  functionName: "assets",
  args: [assetId],
});
console.log("Current asset info:", info);

if (info.approved) {
  console.log("✅ Asset already registered and approved. Nothing to do.");
  process.exit(0);
}

console.log("Registering HIBT asset...");
const hash = await walletClient.writeContract({
  address: TOKEN_ADDR,
  abi: REGISTER_ABI,
  functionName: "registerAsset",
  args: [
    assetId,
    3,                    // AssetType.Bond
    ASSET_NAME,
    BigInt("1941408000"), // 15 Jul 2031 UTC
    BigInt(550),          // 5.50% coupon in bps
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  ],
});
console.log("tx sent:", hash);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log("✅ Registered! Block:", receipt.blockNumber, "Status:", receipt.status);
