// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ComplianceOracle
/// @notice Stores AI-generated compliance scores on-chain, gating RWA token issuance.
///         This satisfies the hackathon requirement: "AI-powered function callable on-chain".
contract ComplianceOracle is AccessControl {
    bytes32 public constant ORACLE_UPDATER_ROLE = keccak256("ORACLE_UPDATER_ROLE");

    struct ScoreRecord {
        uint8  score;       // 0-100
        uint64 updatedAt;   // block.timestamp
        bytes32 reportHash; // keccak256 of full AI report JSON stored off-chain (EigenDA)
    }

    mapping(bytes32 assetId => ScoreRecord) private _scores;

    event ComplianceScoreUpdated(
        bytes32 indexed assetId,
        uint8           score,
        bytes32         reportHash,
        address indexed updater
    );

    error InvalidScore(uint8 score);

    constructor(address admin, address updater) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_UPDATER_ROLE, updater == address(0) ? admin : updater);
    }

    /// @notice Called by the backend oracle service after AI compliance analysis
    function submitScore(bytes32 assetId, uint8 score, bytes32 reportHash)
        external
        onlyRole(ORACLE_UPDATER_ROLE)
    {
        if (score > 100) revert InvalidScore(score);
        _scores[assetId] = ScoreRecord({
            score:      score,
            updatedAt:  uint64(block.timestamp),
            reportHash: reportHash
        });
        emit ComplianceScoreUpdated(assetId, score, reportHash, msg.sender);
    }

    function getScore(bytes32 assetId)
        external
        view
        returns (uint8 score, uint64 updatedAt, bytes32 reportHash)
    {
        ScoreRecord memory r = _scores[assetId];
        return (r.score, r.updatedAt, r.reportHash);
    }

    function isCompliant(bytes32 assetId, uint8 threshold)
        external
        view
        returns (bool)
    {
        return _scores[assetId].score >= threshold;
    }
}
