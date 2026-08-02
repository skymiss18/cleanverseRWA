// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title IdentityRegistry
/// @notice On-chain KYC whitelist for RWA token investors (SFC Suitability Requirement).
contract IdentityRegistry is AccessControl {
    bytes32 public constant COMPLIANCE_OFFICER_ROLE = keccak256("COMPLIANCE_OFFICER_ROLE");

    struct Investor {
        bool    isVerified;
        bool    amlClear;
        bytes32 jurisdiction; // e.g. keccak256("HK") or keccak256("SG")
        uint64  kycExpiry;    // unix timestamp
    }

    mapping(address investor => Investor) private _investors;

    event InvestorUpdated(
        address indexed investor,
        bool isVerified,
        bool amlClear,
        bytes32 jurisdiction,
        uint64 kycExpiry
    );

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_OFFICER_ROLE, admin);
    }

    function upsertInvestor(
        address investor,
        bool    isVerified,
        bool    amlClear,
        bytes32 jurisdiction,
        uint64  kycExpiry
    ) external onlyRole(COMPLIANCE_OFFICER_ROLE) {
        _investors[investor] = Investor({
            isVerified:   isVerified,
            amlClear:     amlClear,
            jurisdiction: jurisdiction,
            kycExpiry:    kycExpiry
        });
        emit InvestorUpdated(investor, isVerified, amlClear, jurisdiction, kycExpiry);
    }

    function getInvestor(address investor) external view returns (Investor memory) {
        return _investors[investor];
    }

    /// @notice Returns true if investor passes KYC + AML + not expired
    function isEligible(address investor) external view returns (bool) {
        Investor memory p = _investors[investor];
        return p.isVerified && p.amlClear && p.kycExpiry >= uint64(block.timestamp);
    }
}
