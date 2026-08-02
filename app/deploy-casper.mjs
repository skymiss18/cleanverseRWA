import casperSdk from "casper-js-sdk";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "path";
import { fileURLToPath } from "url";

const {
  Args,
  Deploy,
  DeployHeader,
  ExecutableDeployItem,
  HttpHandler,
  KeyAlgorithm,
  PrivateKey,
  RpcClient,
} = casperSdk;

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = __dirname;
const repoRoot = resolve(appDir, "..");
const keyDir = resolve(repoRoot, "casper-keys");
const artifactsDir = resolve(appDir, "casper-artifacts");
const envPath = resolve(appDir, ".env.local");
const envExamplePath = resolve(appDir, ".env.example");

const DEFAULT_RPC_URL = "https://rpc.testnet.casperlabs.io";
const DEFAULT_CHAIN_NAME = "casper-test";
const DEFAULT_CLOUD_URL = "https://event-store-api-clarity-testnet.make.services";
const DEFAULT_INSTALL_PAYMENT = "150000000000"; // 150 CSPR in motes; override with CASPER_INSTALL_PAYMENT.
const DEFAULT_TIMEOUT_MS = 180000;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (["force-env", "no-env"].includes(rawKey)) {
      args[rawKey] = true;
      continue;
    }
    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[rawKey] = true;
      continue;
    }
    args[rawKey] = next;
    i += 1;
  }
  return args;
}

function readTextIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : undefined;
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvFile(filePath) {
  const text = readTextIfExists(filePath);
  if (!text) return {};

  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = unquoteEnvValue(match[2]);
  }
  return values;
}

function envValue(key, fileValues) {
  const value = process.env[key] ?? fileValues[key];
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanHex(value, label) {
  const hex = String(value).trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error(`${label} must be even-length hex, got ${hex.length} chars`);
  }
  return hex;
}

function hashToHex(hash) {
  if (!hash) return "";
  if (typeof hash === "string") return hash;
  if (typeof hash.toHex === "function") return hash.toHex();
  return String(hash);
}

function readKeyFile(name) {
  const filePath = join(keyDir, name);
  const text = readTextIfExists(filePath);
  return text?.trim();
}

function resolveWasmPath(cliWasmPath) {
  if (cliWasmPath) {
    const wasmPath = isAbsolute(cliWasmPath)
      ? cliWasmPath
      : resolve(process.cwd(), cliWasmPath);
    if (!existsSync(wasmPath)) {
      throw new Error(`WASM file not found: ${wasmPath}`);
    }
    return wasmPath;
  }

  if (!existsSync(artifactsDir)) {
    throw new Error(
      `No --wasm path was provided and ${relative(repoRoot, artifactsDir)} does not exist. ` +
        "Download the GitHub Actions artifact first."
    );
  }

  const wasmFiles = readdirSync(artifactsDir)
    .filter((file) => extname(file).toLowerCase() === ".wasm")
    .map((file) => resolve(artifactsDir, file));

  if (wasmFiles.length === 0) {
    throw new Error(`No .wasm files found in ${relative(repoRoot, artifactsDir)}`);
  }

  wasmFiles.sort((a, b) => wasmScore(b) - wasmScore(a));
  return wasmFiles[0];
}

function wasmScore(filePath) {
  const name = basename(filePath).toLowerCase();
  let score = 0;
  if (name.includes("compliance")) score += 100;
  if (name.includes("oracle")) score += 50;
  if (name.includes("identity") || name.includes("registry")) score -= 50;
  return score;
}

function getExecutionResult(waitResult) {
  return (
    waitResult?.executionInfo?.executionResult ??
    waitResult?.execution_info?.execution_result ??
    waitResult?.executionResultsV1?.[0]?.result ??
    waitResult?.execution_results_v1?.[0]?.result ??
    waitResult?.execution_results?.[0]?.result ??
    undefined
  );
}

function findFailureMessage(value) {
  if (!value || typeof value !== "object") return undefined;

  if (typeof value.failure === "string") return value.failure;
  if (typeof value.Failure === "string") return value.Failure;
  if (value.failure) return stringifyCompact(value.failure);
  if (value.Failure) return stringifyCompact(value.Failure);
  if (typeof value.errorMessage === "string") return value.errorMessage;
  if (typeof value.error_message === "string") return value.error_message;

  for (const child of Object.values(value)) {
    const message = findFailureMessage(child);
    if (message) return message;
  }
  return undefined;
}

function stringifyCompact(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractContractHash(waitResult) {
  const candidates = [];
  walkForHashes(waitResult, [], candidates);

  const unique = new Map();
  for (const candidate of candidates) {
    const previous = unique.get(candidate.normalized);
    if (!previous || candidate.score > previous.score) {
      unique.set(candidate.normalized, candidate);
    }
  }

  const sorted = [...unique.values()].sort((a, b) => b.score - a.score);
  const best = sorted.find((candidate) => candidate.score >= 50);
  if (!best) {
    const debugPath = writeDeployDebug(waitResult);
    throw new Error(
      `Could not confidently extract a contract hash from the deploy result. ` +
        `Saved debug JSON to ${relative(repoRoot, debugPath)}.`
    );
  }
  return best.normalized;
}

function walkForHashes(value, trail, candidates) {
  if (value === null || value === undefined) return;

  if (typeof value === "string") {
    collectHashesFromString(value, trail, candidates);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((child, index) => walkForHashes(child, [...trail, String(index)], candidates));
    return;
  }

  if (typeof value !== "object") return;

  const context = Object.entries(value)
    .filter(([, child]) => typeof child === "string")
    .map(([key, child]) => `${key}:${child}`)
    .join(" ");
  const contextualTrail = /contract|addressable|entity/i.test(context)
    ? [...trail, "contract-context"]
    : trail;

  for (const [key, child] of Object.entries(value)) {
    walkForHashes(child, [...contextualTrail, key], candidates);
  }
}

function collectHashesFromString(value, trail, candidates) {
  const hashPattern = /\b(?:(contract|hash)-)?([0-9a-fA-F]{64})\b/g;
  let match;
  while ((match = hashPattern.exec(value)) !== null) {
    const [, prefix = "", rawHex] = match;
    const normalized = `contract-${rawHex.toLowerCase()}`;
    const pathText = trail.join(".").toLowerCase();
    let score = 0;

    if (prefix === "contract") score += 120;
    if (prefix === "hash") score += 10;
    if (/contract_hash|contracthash/.test(pathText)) score += 120;
    if (/contract|writecontract|storedvalue/.test(pathText)) score += 80;
    if (/named.?keys?|name/.test(pathText)) score += 30;
    if (/compliance|oracle/.test(pathText)) score += 50;
    if (/package/.test(pathText)) score -= 120;
    if (/deploy.?hash|block.?hash|state.?root|account.?hash|transaction.?hash/.test(pathText)) {
      score -= 100;
    }

    candidates.push({ normalized, score, trail: trail.join(".") });
  }
}

function writeDeployDebug(waitResult) {
  mkdirSync(artifactsDir, { recursive: true });
  const debugPath = resolve(artifactsDir, "last-deploy-result.json");
  writeFileSync(debugPath, `${JSON.stringify(waitResult, null, 2)}\n`);
  return debugPath;
}

function updateEnvFile({
  contractHash,
  secretHex,
  publicHex,
  chainName,
  rpcUrl,
  cloudUrl,
  forceEnv,
}) {
  const sourceText =
    readTextIfExists(envPath) ??
    readTextIfExists(envExamplePath) ??
    "# HarbourRWA local environment\n";

  const updates = {
    NEXT_PUBLIC_ORACLE_CHAIN: "casper",
    CASPER_ORACLE_KEY: secretHex,
    CASPER_ORACLE_PUBLIC_KEY: publicHex,
    CASPER_COMPLIANCE_ORACLE_HASH: contractHash,
    CASPER_CHAIN_NAME: chainName,
    CASPER_RPC_URL: rpcUrl,
    CASPER_CLOUD_URL: cloudUrl,
  };
  const deployProducedKeys = new Set(["CASPER_COMPLIANCE_ORACLE_HASH"]);
  const seen = new Set();
  const updated = [];
  const kept = [];

  const lines = sourceText.split(/\r?\n/);
  const nextLines = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!match) return line;

    const [, , key] = match;
    if (!(key in updates)) return line;

    seen.add(key);
    const oldValue = unquoteEnvValue(match[4]);
    const newValue = updates[key];
    if (
      oldValue &&
      oldValue !== newValue &&
      !forceEnv &&
      !deployProducedKeys.has(key)
    ) {
      kept.push(key);
      return line;
    }

    updated.push(key);
    return `${key}=${newValue}`;
  });

  const missingKeys = Object.keys(updates).filter((key) => !seen.has(key));
  if (missingKeys.length > 0) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push("# ── Casper Network (generated by deploy-casper.mjs) ───────────────");
    for (const key of missingKeys) {
      nextLines.push(`${key}=${updates[key]}`);
      updated.push(key);
    }
  }

  const nextText = `${nextLines.join("\n").replace(/\n*$/, "")}\n`;
  writeFileSync(envPath, nextText);

  return { updated, kept };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const envFileValues = parseEnvFile(envPath);

  const wasmPath = resolveWasmPath(cli.wasm);
  const secretHex = cleanHex(
    envValue("CASPER_ORACLE_KEY", envFileValues) ?? readKeyFile("secret_key.hex") ?? "",
    "CASPER_ORACLE_KEY / casper-keys/secret_key.hex"
  );
  const privateKey = PrivateKey.fromHex(secretHex, KeyAlgorithm.ED25519);
  const publicHex = cleanHex(
    envValue("CASPER_ORACLE_PUBLIC_KEY", envFileValues) ??
      readKeyFile("public_key.hex") ??
      privateKey.publicKey.toHex(),
    "CASPER_ORACLE_PUBLIC_KEY / casper-keys/public_key.hex"
  );

  const rpcUrl = envValue("CASPER_RPC_URL", envFileValues) ?? DEFAULT_RPC_URL;
  const chainName = envValue("CASPER_CHAIN_NAME", envFileValues) ?? DEFAULT_CHAIN_NAME;
  const cloudUrl = envValue("CASPER_CLOUD_URL", envFileValues) ?? DEFAULT_CLOUD_URL;
  const paymentAmount =
    String(cli.payment ?? envValue("CASPER_INSTALL_PAYMENT", envFileValues) ?? DEFAULT_INSTALL_PAYMENT);
  const timeoutMs = Number(
    cli["timeout-ms"] ?? envValue("CASPER_DEPLOY_TIMEOUT_MS", envFileValues) ?? DEFAULT_TIMEOUT_MS
  );

  console.log("Deploying Casper contract WASM...");
  console.log("WASM:", relative(repoRoot, wasmPath));
  console.log("RPC:", rpcUrl);
  console.log("Chain:", chainName);
  console.log("Public key / account:", publicHex);
  console.log("Payment motes:", paymentAmount);

  const wasmBytes = readFileSync(wasmPath);
  const session = ExecutableDeployItem.newModuleBytes(wasmBytes, Args.fromNamedArgs([]));
  const payment = ExecutableDeployItem.standardPayment(paymentAmount);
  const header = DeployHeader.default();
  header.chainName = chainName;
  header.account = privateKey.publicKey;

  const deploy = Deploy.makeDeploy(header, payment, session);
  deploy.sign(privateKey);

  const rpc = new RpcClient(new HttpHandler(rpcUrl));
  const putResult = await rpc.putDeploy(deploy);
  const deployHash = hashToHex(putResult.deployHash ?? putResult.deploy_hash);
  console.log("Deploy submitted:", deployHash);
  console.log("Explorer:", `https://testnet.cspr.live/deploy/${deployHash}`);
  console.log(`Waiting up to ${timeoutMs}ms for execution...`);

  const waitResult = await rpc.waitForDeploy(deploy, timeoutMs);
  const executionResult = getExecutionResult(waitResult);
  const failureMessage = findFailureMessage(executionResult);
  if (failureMessage) {
    writeDeployDebug(waitResult);
    throw new Error(`Casper deploy execution failed: ${failureMessage}`);
  }

  const contractHash = extractContractHash(waitResult);
  console.log("Contract hash:", contractHash);

  if (!cli["no-env"]) {
    const { updated, kept } = updateEnvFile({
      contractHash,
      secretHex,
      publicHex,
      chainName,
      rpcUrl,
      cloudUrl,
      forceEnv: Boolean(cli["force-env"]),
    });
    console.log("Updated env file:", relative(repoRoot, envPath));
    console.log("Updated keys:", [...new Set(updated)].join(", "));
    if (kept.length > 0) {
      console.log(
        "Kept existing non-empty keys (use --force-env to overwrite):",
        [...new Set(kept)].join(", ")
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
