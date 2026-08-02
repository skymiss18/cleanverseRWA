// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CleanversePoolAdapter} from "./CleanversePoolAdapter.sol";

/// @title HarbourRWAToken
/// @notice ERC-20 token representing a tokenised real-world asset on Ethereum.
///         All mints and transfers are gated by a Cleanverse-registered compliance pool.
///         Implements the core ERC-3643-inspired pattern: compliance-gated transfers.
contract HarbourRWAToken is ERC20Pausable, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    CleanversePoolAdapter public immutable compliancePool;
    IERC20 public immutable couponToken;

    /// @notice Asset type: 0 = REIT, 1 = GreenBond, 2 = TradeReceivable, 3 = Bond
    enum AssetType { REIT, GreenBond, TradeReceivable, Bond }

    struct AssetInfo {
        bool      approved;
        AssetType assetType;
        string    name;
        uint256   maturityDate; // 0 for REITs (perpetual)
        uint256   couponBps;    // annual coupon in bps (e.g. 500 = 5%)
        bytes32   prospectusCommitment; // keccak256 of full doc stored on EigenDA
    }

    mapping(bytes32 assetId => AssetInfo) public assets;

    // Dividend / coupon tracking for REIT / GreenBond
    struct DividendRecord {
        uint256 paymentDate;
        uint256 amountPerToken; // couponToken units per 1 token (18 decimals)
        bool    distributed;
    }
    mapping(bytes32 assetId => DividendRecord[]) public dividendSchedules;
    mapping(bytes32 assetId => mapping(uint256 index => uint256 remainingAmount)) public dividendFunding;
    mapping(bytes32 assetId => mapping(uint256 index => mapping(address investor => bool claimed))) private dividendClaims;

    event AssetRegistered(bytes32 indexed assetId, AssetType assetType, string name);
    event TokensMinted(address indexed to, bytes32 indexed assetId, uint256 amount);
    event DividendScheduled(bytes32 indexed assetId, uint256 paymentDate, uint256 amountPerToken);
    event DividendFunded(bytes32 indexed assetId, uint256 indexed index, uint256 totalAmount);
    event DividendClaimed(bytes32 indexed assetId, uint256 indexed index, address indexed investor, uint256 amount);

    error ComplianceCheckFailed();
    error AssetNotApproved(bytes32 assetId);
    error NotDueYet();
    error InvalidCouponToken();
    error InvalidDividendIndex(bytes32 assetId, uint256 index);
    error DividendNotFunded(bytes32 assetId, uint256 index);
    error DividendAlreadyFunded(bytes32 assetId, uint256 index);
    error DividendAlreadyClaimed(bytes32 assetId, uint256 index, address investor);
    error FundingShortfall(uint256 expectedAmount, uint256 providedAmount);
    error NothingToClaim(bytes32 assetId, uint256 index, address investor);

    constructor(
        string          memory name_,
        string          memory symbol_,
        address                admin,
        CleanversePoolAdapter  pool,
        IERC20                 couponToken_
    ) ERC20(name_, symbol_) {
        if (address(couponToken_) == address(0)) revert InvalidCouponToken();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
        compliancePool = pool;
        couponToken = couponToken_;
    }

    // ── Asset management ──────────────────────────────────────────────────────

    function registerAsset(
        bytes32   assetId,
        AssetType assetType,
        string    calldata assetName,
        uint256   maturityDate,
        uint256   couponBps,
        bytes32   prospectusCommitment
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        assets[assetId] = AssetInfo({
            approved:               true,
            assetType:              assetType,
            name:                   assetName,
            maturityDate:           maturityDate,
            couponBps:              couponBps,
            prospectusCommitment:   prospectusCommitment
        });
        emit AssetRegistered(assetId, assetType, assetName);
    }

    function scheduleDividend(
        bytes32 assetId,
        uint256 paymentDate,
        uint256 amountPerToken
    ) external onlyRole(ISSUER_ROLE) {
        dividendSchedules[assetId].push(DividendRecord({
            paymentDate:    paymentDate,
            amountPerToken: amountPerToken,
            distributed:    false
        }));
        emit DividendScheduled(assetId, paymentDate, amountPerToken);
    }

    function fundDividend(
        bytes32 assetId,
        uint256 index,
        uint256 totalAmount
    ) external onlyRole(ISSUER_ROLE) {
        if (index >= dividendSchedules[assetId].length) revert InvalidDividendIndex(assetId, index);

        DividendRecord storage record = dividendSchedules[assetId][index];
        if (record.distributed) revert DividendAlreadyFunded(assetId, index);

        uint256 expectedAmount = (record.amountPerToken * totalSupply()) / 1e18;
        if (totalAmount < expectedAmount) revert FundingShortfall(expectedAmount, totalAmount);

        couponToken.safeTransferFrom(msg.sender, address(this), totalAmount);
        dividendFunding[assetId][index] = totalAmount;
        record.distributed = true;

        emit DividendFunded(assetId, index, totalAmount);
    }

    function previewDividendClaim(
        bytes32 assetId,
        uint256 index,
        address investor
    ) public view returns (uint256) {
        if (index >= dividendSchedules[assetId].length) return 0;

        DividendRecord memory record = dividendSchedules[assetId][index];
        if (!record.distributed || block.timestamp < record.paymentDate || dividendClaims[assetId][index][investor]) {
            return 0;
        }

        uint256 balance = balanceOf(investor);
        if (balance == 0) return 0;

        uint256 payout = (record.amountPerToken * balance) / 1e18;
        uint256 remaining = dividendFunding[assetId][index];
        return payout > remaining ? remaining : payout;
    }

    function hasClaimedDividend(
        bytes32 assetId,
        uint256 index,
        address investor
    ) external view returns (bool) {
        return dividendClaims[assetId][index][investor];
    }

    function claimDividend(bytes32 assetId, uint256 index) external whenNotPaused {
        if (index >= dividendSchedules[assetId].length) revert InvalidDividendIndex(assetId, index);

        DividendRecord memory record = dividendSchedules[assetId][index];
        if (block.timestamp < record.paymentDate) revert NotDueYet();
        if (!record.distributed) revert DividendNotFunded(assetId, index);
        if (dividendClaims[assetId][index][msg.sender]) {
            revert DividendAlreadyClaimed(assetId, index, msg.sender);
        }

        uint256 payout = previewDividendClaim(assetId, index, msg.sender);
        if (payout == 0) revert NothingToClaim(assetId, index, msg.sender);

        dividendClaims[assetId][index][msg.sender] = true;
        dividendFunding[assetId][index] -= payout;
        couponToken.safeTransfer(msg.sender, payout);

        emit DividendClaimed(assetId, index, msg.sender, payout);
    }

    // ── Minting (compliance gated) ────────────────────────────────────────────

    function mintForAsset(
        address to,
        uint256 amount,
        bytes32 assetId
    ) external whenNotPaused onlyRole(ISSUER_ROLE) {
        if (!assets[assetId].approved) revert AssetNotApproved(assetId);
        if (!compliancePool.canMint(to, assetId)) revert ComplianceCheckFailed();
        _mint(to, amount);
        emit TokensMinted(to, assetId, amount);
    }

    // ── Transfer override (compliance gated) ──────────────────────────────────

    function _update(address from, address to, uint256 value) internal override {
        // Skip compliance check for mint (from == 0) and burn (to == 0)
        if (from != address(0) && to != address(0)) {
            if (!compliancePool.canTransfer(from, to)) revert ComplianceCheckFailed();
        }
        super._update(from, to, value);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}
