import { ethers, network, run } from "hardhat";
import fs from "fs";
import path from "path";

async function verify(address: string, args: unknown[]) {
  try {
    await run("verify:verify", { address, constructorArguments: args });
    console.log(`  ✅ Verified: ${address}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Already Verified")) {
      console.log(`  ℹ️  Already verified: ${address}`);
    } else {
      console.warn(`  ⚠️  Verify failed (${address}): ${msg}`);
    }
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const isTestnet  = network.name !== "ethereumMainnet";

  console.log(`\nNetwork : ${network.name} (${isTestnet ? "testnet" : "mainnet"})`);
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance : ${ethers.formatEther(balance)} ETH\n`);

  // ── 0. Mock USDY + mETH (testnet only) ─────────────────────────────────────
  let usdyAddr = process.env.USDY_ADDRESS ?? ethers.ZeroAddress;
  let methAddr = process.env.METH_ADDRESS  ?? ethers.ZeroAddress;

  if (isTestnet) {
    console.log("Deploying testnet mocks...");

    const MockUSDY = await ethers.getContractFactory("MockUSDY");
    const mockUsdy = await MockUSDY.deploy(deployer.address);
    await mockUsdy.waitForDeployment();
    usdyAddr = await mockUsdy.getAddress();
    console.log(`  MockUSDY:  ${usdyAddr}`);

    const MockMETH = await ethers.getContractFactory("MockMETH");
    const mockMeth = await MockMETH.deploy(deployer.address);
    await mockMeth.waitForDeployment();
    methAddr = await mockMeth.getAddress();
    console.log(`  MockMETH:  ${methAddr}`);
  }

  // ── 1. ComplianceOracle ─────────────────────────────────────────────────────
  const Oracle = await ethers.getContractFactory("ComplianceOracle");
  const oracle = await Oracle.deploy(deployer.address, deployer.address);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log(`ComplianceOracle:  ${oracleAddr}`);

  // ── 2. IdentityRegistry ─────────────────────────────────────────────────────
  const Registry = await ethers.getContractFactory("IdentityRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`IdentityRegistry:  ${registryAddr}`);

  // ── 3. ComplianceModule (min score = 70) ────────────────────────────────────
  const Module = await ethers.getContractFactory("ComplianceModule");
  const module = await Module.deploy(deployer.address, registryAddr, oracleAddr, 70);
  await module.waitForDeployment();
  const moduleAddr = await module.getAddress();
  console.log(`ComplianceModule:  ${moduleAddr}`);

  // ── 4. CleanversePoolAdapter ────────────────────────────────────────────────
  const Pool = await ethers.getContractFactory("CleanversePoolAdapter");
  const pool = await Pool.deploy(deployer.address, moduleAddr);
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`CleanversePool:    ${poolAddr}`);

  // ── 5. HarbourRWAToken ──────────────────────────────────────────────────────
  const Token = await ethers.getContractFactory("HarbourRWAToken");
  const token = await Token.deploy("Harbour RWA Token", "HRWA", deployer.address, poolAddr, usdyAddr);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`HarbourRWAToken:   ${tokenAddr}`);

  // ── 6. Register HIBT asset on HarbourRWAToken ────────────────────────────────
  const HIBT_ASSET_NAME = "Harbour Infrastructure Bond Token";
  const hibtAssetId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["string"], [HIBT_ASSET_NAME])
  );
  await token.registerAsset(
    hibtAssetId,
    3,                          // AssetType.Bond
    HIBT_ASSET_NAME,
    BigInt("1941408000"),        // 15 Jul 2031 UTC
    BigInt(550),                // 5.50% coupon in bps
    ethers.ZeroHash             // prospectus commitment (set later)
  );
  console.log(`HIBT assetId registered: ${hibtAssetId}`);

  // ── 7. YieldAggregator ──────────────────────────────────────────────────────
  const Yield = await ethers.getContractFactory("YieldAggregator");
  const yieldAgg = await Yield.deploy(deployer.address, usdyAddr, methAddr);
  await yieldAgg.waitForDeployment();
  const yieldAddr = await yieldAgg.getAddress();
  console.log(`YieldAggregator:   ${yieldAddr}`);

  // ── Summary ─────────────────────────────────────────────────────────────────
  const addresses = {
    oracleAddr,
    registryAddr,
    moduleAddr,
    poolAddr,
    tokenAddr,
    yieldAddr,
    ...(isTestnet ? { usdyAddr, methAddr } : {}),
  };
  console.log("\n=== Deployment Summary ===");
  console.log(JSON.stringify(addresses, null, 2));

  // Write .env snippet for easy copy-paste
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const envSnippet = `
# Auto-generated by deploy.ts — ${new Date().toISOString()}
# Network: ${network.name}
NEXT_PUBLIC_CHAIN_ID=${chainId}
NEXT_PUBLIC_COMPLIANCE_ORACLE_ADDRESS=${oracleAddr}
NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS=${registryAddr}
NEXT_PUBLIC_COMPLIANCE_MODULE_ADDRESS=${moduleAddr}
NEXT_PUBLIC_CLEANVERSE_POOL_ADDRESS=${poolAddr}
NEXT_PUBLIC_HARBOUR_RWA_TOKEN_ADDRESS=${tokenAddr}
NEXT_PUBLIC_YIELD_AGGREGATOR_ADDRESS=${yieldAddr}
NEXT_PUBLIC_USDY_ADDRESS=${usdyAddr}
${isTestnet ? `USDY_ADDRESS=${usdyAddr}\nMETH_ADDRESS=${methAddr}` : ""}
`.trim();

  const outPath = path.join(__dirname, "../../.env.deployed");
  fs.writeFileSync(outPath, envSnippet + "\n");
  console.log(`\n📄 Contract addresses written to .env.deployed`);
  console.log("   Copy relevant lines into your .env.local\n");

  // ── Optional verification (wait a few seconds for explorer indexing) ────────
  if (process.env.ETHERSCAN_API_KEY && process.env.ETHERSCAN_API_KEY !== "placeholder") {
    console.log("Waiting 10s for explorer to index contracts...");
    await new Promise((r) => setTimeout(r, 10_000));

    console.log("\nVerifying contracts on Etherscan...");
    await verify(oracleAddr,    [deployer.address, deployer.address]);
    await verify(registryAddr,  [deployer.address]);
    await verify(moduleAddr,    [deployer.address, registryAddr, oracleAddr, 70]);
    await verify(poolAddr,      [deployer.address, moduleAddr]);
    await verify(tokenAddr,     ["Harbour RWA Token", "HRWA", deployer.address, poolAddr, usdyAddr]);
    await verify(yieldAddr,     [deployer.address, usdyAddr, methAddr]);
    if (isTestnet) {
      await verify(usdyAddr,    [deployer.address]);
      await verify(methAddr,    [deployer.address]);
    }
    console.log("\n✅ Verification complete.");
  } else {
    console.log("ℹ️  Set ETHERSCAN_API_KEY in .env.local to auto-verify contracts.");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

