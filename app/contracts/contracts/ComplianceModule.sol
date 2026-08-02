// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";
import {ComplianceOracle} from "./ComplianceOracle.sol";

/// @title ComplianceModule
/// @notice Enforces HK SFC tokenisation rules: investor eligibility + asset compliance score.
contract ComplianceModule is AccessControl {
    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");

    IdentityRegistry public immutable identityRegistry;
    ComplianceOracle public immutable complianceOracle;

    uint8 public minComplianceScore;

    event MinScoreUpdated(uint8 newScore);

    constructor(
        address          admin,
        IdentityRegistry registry,
        ComplianceOracle oracle,
        uint8            minScore
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POLICY_ADMIN_ROLE, admin);
        identityRegistry   = registry;
        complianceOracle   = oracle;
        minComplianceScore = minScore;
    }

    function setMinComplianceScore(uint8 score) external onlyRole(POLICY_ADMIN_ROLE) {
        require(score <= 100, "invalid");
        minComplianceScore = score;
        emit MinScoreUpdated(score);
    }

    /// @notice Gate for minting: investor KYC eligible AND asset AI score >= threshold
    function canMint(address to, bytes32 assetId) external view returns (bool) {
        return identityRegistry.isEligible(to)
            && complianceOracle.isCompliant(assetId, minComplianceScore);
    }

    /// @notice Gate for transfers: both parties must be KYC-eligible (SFC professional investor rule)
    function canTransfer(address from, address to) external view returns (bool) {
        return identityRegistry.isEligible(from) && identityRegistry.isEligible(to);
    }
}
