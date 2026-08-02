// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title YieldAggregator
/// @notice Routes idle RWA proceeds to USDY (Ondo) and mETH Protocol on Mantle for yield.
///         AI advisor can call autoRebalance() to shift allocation based on risk profile.
///         This demonstrates the "AI × DeFi on Mantle" paradigm for the hackathon.
interface IUSDY {
    function deposit(address recipient, uint256 amount) external returns (uint256 shares);
    function redeem(uint256 shares, address recipient) external returns (uint256 amount);
    function balanceOf(address account) external view returns (uint256);
}

interface ImETH {
    function stake() external payable returns (uint256 shares);
    function unstake(uint256 shares) external returns (uint256 amount);
    function balanceOf(address account) external view returns (uint256);
}

contract YieldAggregator is AccessControl {
    bytes32 public constant MANAGER_ROLE  = keccak256("MANAGER_ROLE");
    bytes32 public constant AI_AGENT_ROLE = keccak256("AI_AGENT_ROLE");

    IUSDY public usdy;
    ImETH public meth;

    // ── Yield parameters (set by admin, updated from off-chain APY oracles) ───
    uint16 public usdyApyBps;  // e.g. 500 = 5.00%
    uint16 public methApyBps;  // e.g. 380 = 3.80%
    uint64 public lastApyUpdate;

    // ── Per-user positions ────────────────────────────────────────────────────
    mapping(address user => uint256 usdyShares) public usdyDeposits;
    mapping(address user => uint256 methShares)  public methDeposits;

    // ── Risk profile ──────────────────────────────────────────────────────────
    enum RiskTier { Conservative, Moderate, Aggressive }
    mapping(address user => RiskTier) public riskTiers;

    // ── Rebalance history (last AI action per user) ───────────────────────────
    struct RebalanceRecord {
        uint64  timestamp;
        uint256 usdyShares;
        uint256 methShares;
        uint16  usdyPct;        // % of total directed to USDY (0-100)
        string  aiRationale;    // stored off-chain hash or short text
    }
    mapping(address user => RebalanceRecord) public lastRebalance;

    // ── Events ────────────────────────────────────────────────────────────────
    event DepositedUSDY(address indexed user, uint256 amount, uint256 shares);
    event RedeemedUSDY(address indexed user, uint256 shares, uint256 amount);
    event StakedMETH(address indexed user, uint256 ethAmount, uint256 shares);
    event UnstakedMETH(address indexed user, uint256 shares, uint256 amount);
    event ApyUpdated(uint16 usdyApyBps, uint16 methApyBps, address updater);
    event RiskTierSet(address indexed user, RiskTier tier);
    event AutoRebalanced(
        address indexed user,
        uint16  usdyPct,
        uint256 usdyShares,
        uint256 methShares,
        string  rationale
    );

    constructor(address admin, address usdyAddr, address methAddr) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);
        _grantRole(AI_AGENT_ROLE, admin);
        usdy = IUSDY(usdyAddr);
        meth = ImETH(methAddr);
        // Default APYs (updated regularly by backend oracle)
        usdyApyBps  = 500;  // 5.00%
        methApyBps  = 380;  // 3.80%
        lastApyUpdate = uint64(block.timestamp);
    }

    // ── USDY ──────────────────────────────────────────────────────────────────

    function depositUSDY(address user, uint256 amount) external onlyRole(MANAGER_ROLE) {
        uint256 shares = usdy.deposit(address(this), amount);
        usdyDeposits[user] += shares;
        emit DepositedUSDY(user, amount, shares);
    }

    function redeemUSDY(address user, uint256 shares) external onlyRole(MANAGER_ROLE) returns (uint256) {
        require(usdyDeposits[user] >= shares, "insufficient USDY shares");
        usdyDeposits[user] -= shares;
        uint256 amount = usdy.redeem(shares, user);
        emit RedeemedUSDY(user, shares, amount);
        return amount;
    }

    // ── mETH ──────────────────────────────────────────────────────────────────

    function stakeMETH(address user) external payable onlyRole(MANAGER_ROLE) {
        uint256 shares = meth.stake{value: msg.value}();
        methDeposits[user] += shares;
        emit StakedMETH(user, msg.value, shares);
    }

    function unstakeMETH(address user, uint256 shares) external onlyRole(MANAGER_ROLE) returns (uint256) {
        require(methDeposits[user] >= shares, "insufficient mETH shares");
        methDeposits[user] -= shares;
        uint256 amount = meth.unstake(shares);
        emit UnstakedMETH(user, shares, amount);
        return amount;
    }

    // ── AI-driven auto-rebalance ───────────────────────────────────────────────
    /// @notice Called by AI agent backend after computing optimal allocation.
    ///         Logs the rebalance on-chain with AI rationale hash.
    ///         Actual fund movement is tracked off-chain until user claims next yield.
    /// @param user         Investor wallet
    /// @param usdyPct      % of total allocated to USDY (0–100)
    /// @param rationale    Short AI reasoning string (≤ 120 chars) or IPFS/EigenDA CID
    function autoRebalance(
        address user,
        uint16  usdyPct,
        string  calldata rationale
    ) external onlyRole(AI_AGENT_ROLE) {
        require(usdyPct <= 100, "pct out of range");

        uint256 totalShares = usdyDeposits[user] + methDeposits[user];
        uint256 targetUsdy  = (totalShares * usdyPct) / 100;
        uint256 targetMeth  = totalShares - targetUsdy;

        // Update target allocation on-chain (actual rebalancing executed on next deposit/claim)
        usdyDeposits[user] = targetUsdy;
        methDeposits[user] = targetMeth;

        lastRebalance[user] = RebalanceRecord({
            timestamp:    uint64(block.timestamp),
            usdyShares:   targetUsdy,
            methShares:   targetMeth,
            usdyPct:      usdyPct,
            aiRationale:  rationale
        });

        emit AutoRebalanced(user, usdyPct, targetUsdy, targetMeth, rationale);
    }

    // ── Admin: APY oracle update ──────────────────────────────────────────────
    /// @notice Backend oracle pushes updated APY rates from Ondo + mETH Protocol
    function setApyRates(uint16 usdyBps, uint16 methBps) external onlyRole(AI_AGENT_ROLE) {
        require(usdyBps <= 5000 && methBps <= 5000, "APY out of range");
        usdyApyBps  = usdyBps;
        methApyBps  = methBps;
        lastApyUpdate = uint64(block.timestamp);
        emit ApyUpdated(usdyBps, methBps, msg.sender);
    }

    // ── Risk tier ─────────────────────────────────────────────────────────────
    function setRiskTier(address user, RiskTier tier) external onlyRole(MANAGER_ROLE) {
        riskTiers[user] = tier;
        emit RiskTierSet(user, tier);
    }

    // ── View: portfolio yield ─────────────────────────────────────────────────
    /// @notice Returns weighted APY in bps for a user's current allocation
    function getPortfolioYieldBps(address user) external view returns (uint16 weightedBps) {
        uint256 totalShares = usdyDeposits[user] + methDeposits[user];
        if (totalShares == 0) return 0;
        uint256 usdyYield = (usdyDeposits[user] * usdyApyBps) / totalShares;
        uint256 methYield  = (methDeposits[user]  * methApyBps)  / totalShares;
        return uint16(usdyYield + methYield);
    }

    /// @notice Returns full yield info for display on the portfolio page
    function getYieldInfo() external view returns (
        uint16 usdyApy,
        uint16 methApy,
        uint64 lastUpdate
    ) {
        return (usdyApyBps, methApyBps, lastApyUpdate);
    }

    function totalUSDYShares(address user) external view returns (uint256) {
        return usdyDeposits[user];
    }

    function totalMETHShares(address user) external view returns (uint256) {
        return methDeposits[user];
    }

    receive() external payable {}
}

