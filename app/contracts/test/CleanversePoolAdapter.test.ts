import { expect } from "chai";
import { ethers } from "hardhat";

describe("CleanversePoolAdapter", function () {
  async function deployFixture() {
    const [owner, investor, recipient] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("ComplianceOracle");
    const oracle = await Oracle.deploy(owner.address, owner.address);

    const Registry = await ethers.getContractFactory("IdentityRegistry");
    const registry = await Registry.deploy(owner.address);

    const Module = await ethers.getContractFactory("ComplianceModule");
    const module = await Module.deploy(owner.address, await registry.getAddress(), await oracle.getAddress(), 70);

    const Pool = await ethers.getContractFactory("CleanversePoolAdapter");
    const pool = await Pool.deploy(owner.address, await module.getAddress());

    const Coupon = await ethers.getContractFactory("MockUSDY");
    const coupon = await Coupon.deploy(owner.address);

    const Token = await ethers.getContractFactory("HarbourRWAToken");
    const token = await Token.deploy("Harbour RWA Token", "HRWA", owner.address, await pool.getAddress(), await coupon.getAddress());

    const assetId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["Test Bond"]));
    await token.registerAsset(assetId, 3, "Test Bond", 0, 500, ethers.ZeroHash);
    await oracle.submitScore(assetId, 90, ethers.ZeroHash);

    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86_400);
    const jurisdiction = ethers.keccak256(ethers.toUtf8Bytes("HK"));
    await registry.upsertInvestor(investor.address, true, true, jurisdiction, expiry);
    await registry.upsertInvestor(recipient.address, true, true, jurisdiction, expiry);

    return { owner, investor, recipient, pool, token, assetId };
  }

  it("exposes the owner required by Cleanverse pool registration", async function () {
    const { owner, pool } = await deployFixture();
    expect(await pool.owner()).to.equal(owner.address);
  });

  it("blocks minting and transfers while the pool is paused", async function () {
    const { investor, recipient, pool, token, assetId } = await deployFixture();

    await token.mintForAsset(investor.address, ethers.parseEther("2"), assetId);
    await token.connect(investor).transfer(recipient.address, ethers.parseEther("1"));

    await pool.setPaused(true);
    await expect(token.mintForAsset(investor.address, ethers.parseEther("1"), assetId))
      .to.be.revertedWithCustomError(token, "ComplianceCheckFailed");
    await expect(token.connect(recipient).transfer(investor.address, ethers.parseEther("1")))
      .to.be.revertedWithCustomError(token, "ComplianceCheckFailed");
  });

  it("allows only the owner to synchronize pause state", async function () {
    const { investor, pool } = await deployFixture();
    await expect(pool.connect(investor).setPaused(true))
      .to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount")
      .withArgs(investor.address);
  });
});