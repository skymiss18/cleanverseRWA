// ComplianceOracle — Casper/Odra port of ComplianceOracle.sol
//
// Stores AI-generated compliance scores on-chain, gating RWA token issuance.
// Score is written by the backend oracle service after AI analysis.
// Threshold: score >= 70 is considered compliant (mirrors Solidity version).

use odra::prelude::*;

// ── Custom types ──────────────────────────────────────────────────────────────

#[odra::odra_type]
#[derive(Default)]
pub struct ScoreRecord {
    pub score: u8,          // 0-100 AI compliance score
    pub updated_at: u64,    // block timestamp when last updated
    pub report_hash: [u8; 32], // blake2b hash of full AI report JSON
}

// ── Events ────────────────────────────────────────────────────────────────────

#[odra::event]
pub struct ComplianceScoreUpdated {
    pub asset_id: String,
    pub score: u8,
    pub report_hash: [u8; 32],
    pub updater: Address,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[odra::odra_error]
pub enum OracleError {
    InvalidScore = 1,
    Unauthorized = 2,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[odra::module(events = [ComplianceScoreUpdated])]
pub struct ComplianceOracle {
    /// Owner account that is allowed to update scores (oracle updater)
    owner: Var<Address>,
    /// asset_id (String) → ScoreRecord
    scores: Mapping<String, ScoreRecord>,
}

#[odra::module]
impl ComplianceOracle {
    /// Initialise the contract. The deployer becomes the oracle updater.
    pub fn init(&mut self) {
        self.owner.set(self.env().caller());
    }

    // ── Write entry points ──────────────────────────────────────────────────

    /// Submit an AI compliance score for a given asset.
    /// Only the oracle updater (owner) may call this.
    pub fn submit_score(&mut self, asset_id: String, score: u8, report_hash: [u8; 32]) {
        self.assert_owner();
        if score > 100 {
            self.env().revert(OracleError::InvalidScore);
        }
        let record = ScoreRecord {
            score,
            updated_at: self.env().get_block_time(),
            report_hash,
        };
        self.scores.set(&asset_id, record);
        self.env().emit_event(ComplianceScoreUpdated {
            asset_id,
            score,
            report_hash,
            updater: self.env().caller(),
        });
    }

    /// Transfer oracle updater role to a new address.
    pub fn transfer_ownership(&mut self, new_owner: Address) {
        self.assert_owner();
        self.owner.set(new_owner);
    }

    // ── Read entry points ───────────────────────────────────────────────────

    /// Return the score record for an asset, or a zero-default if not set.
    pub fn get_score(&self, asset_id: String) -> ScoreRecord {
        self.scores.get_or_default(&asset_id)
    }

    /// Return true if the asset's score meets `threshold` (default 70).
    pub fn is_compliant(&self, asset_id: String, threshold: u8) -> bool {
        let record = self.scores.get_or_default(&asset_id);
        record.score >= threshold
    }

    /// Return the current oracle updater address.
    pub fn owner(&self) -> Address {
        self.owner.get_or_revert_with(OracleError::Unauthorized)
    }

    // ── Internal helpers ────────────────────────────────────────────────────

    #[inline]
    fn assert_owner(&self) {
        let owner = self.owner.get_or_revert_with(OracleError::Unauthorized);
        if self.env().caller() != owner {
            self.env().revert(OracleError::Unauthorized);
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, NoArgs};

    #[test]
    fn test_submit_and_get_score() {
        let env = odra_test::env();
        let mut oracle = ComplianceOracle::deploy(&env, NoArgs);

        let asset_id = "HIBT".to_string();
        let report_hash = [0u8; 32];

        oracle.submit_score(asset_id.clone(), 85, report_hash);

        let record = oracle.get_score(asset_id.clone());
        assert_eq!(record.score, 85);
        assert_eq!(record.report_hash, report_hash);
    }

    #[test]
    fn test_is_compliant() {
        let env = odra_test::env();
        let mut oracle = ComplianceOracle::deploy(&env, NoArgs);

        let asset_id = "HIBT".to_string();
        oracle.submit_score(asset_id.clone(), 80, [0u8; 32]);

        assert!(oracle.is_compliant(asset_id.clone(), 70));
        assert!(!oracle.is_compliant(asset_id, 90));
    }

    #[test]
    fn test_invalid_score_reverts() {
        let env = odra_test::env();
        let mut oracle = ComplianceOracle::deploy(&env, NoArgs);

        let result = oracle.try_submit_score("X".to_string(), 101, [0u8; 32]);
        assert!(result.is_err());
    }

    #[test]
    fn test_unauthorized_reverts() {
        let env = odra_test::env();
        let mut oracle = ComplianceOracle::deploy(&env, NoArgs);

        env.set_caller(env.get_account(1));
        let result = oracle.try_submit_score("X".to_string(), 80, [0u8; 32]);
        assert!(result.is_err());
    }
}
