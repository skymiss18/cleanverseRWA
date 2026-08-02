// IdentityRegistry — Casper/Odra port of IdentityRegistry.sol
//
// On-chain KYC whitelist for RWA token investors (SFC Suitability Requirement).
// The compliance officer upserts investor records; the token contract checks
// is_eligible() before allowing minting / transfers.

#![cfg_attr(target_arch = "wasm32", no_std)]

use odra::prelude::*;

// ── Custom types ──────────────────────────────────────────────────────────────

/// Jurisdictions encoded as a fixed 3-byte ASCII code (e.g. b"HK\0", b"SG\0").
pub type JurisdictionCode = [u8; 3];

#[odra::odra_type]
#[derive(Default)]
pub struct InvestorRecord {
    pub is_verified: bool,
    pub aml_clear: bool,
    /// ISO 3166-1 alpha-2 country code stored as 3 bytes (e.g. [b'H', b'K', 0])
    pub jurisdiction: JurisdictionCode,
    /// Unix timestamp after which KYC is considered expired (0 = never set)
    pub kyc_expiry: u64,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[odra::event]
pub struct InvestorUpdated {
    pub investor: Address,
    pub is_verified: bool,
    pub aml_clear: bool,
    pub jurisdiction: JurisdictionCode,
    pub kyc_expiry: u64,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[odra::odra_error]
pub enum RegistryError {
    Unauthorized = 1,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[odra::module(events = [InvestorUpdated])]
pub struct IdentityRegistry {
    /// Compliance officer — the only account that may upsert investor records
    compliance_officer: Var<Address>,
    /// investor Address → InvestorRecord
    investors: Mapping<Address, InvestorRecord>,
    /// investor Address → risk band (0 = lowest risk). Added in v2, independent of
    /// InvestorRecord to keep the original storage layout upgrade-compatible.
    risk_bands: Mapping<Address, u8>,
}

#[odra::module]
impl IdentityRegistry {
    /// Initialise the contract. The deployer becomes the compliance officer.
    pub fn init(&mut self) {
        self.compliance_officer.set(self.env().caller());
    }

    // ── Write entry points ──────────────────────────────────────────────────

    /// Create or update an investor's KYC record.
    /// Only the compliance officer may call this.
    pub fn upsert_investor(
        &mut self,
        investor: Address,
        is_verified: bool,
        aml_clear: bool,
        jurisdiction: JurisdictionCode,
        kyc_expiry: u64,
    ) {
        self.assert_compliance_officer();
        let record = InvestorRecord {
            is_verified,
            aml_clear,
            jurisdiction,
            kyc_expiry,
        };
        self.investors.set(&investor, record);
        self.env().emit_event(InvestorUpdated {
            investor,
            is_verified,
            aml_clear,
            jurisdiction,
            kyc_expiry,
        });
    }

    /// Revoke KYC for an investor (sets verified = false, aml_clear = false).
    pub fn revoke_investor(&mut self, investor: Address) {
        self.assert_compliance_officer();
        let mut record = self.investors.get_or_default(&investor);
        record.is_verified = false;
        record.aml_clear = false;
        self.investors.set(&investor, record);
    }

    /// Transfer compliance officer role to a new address.
    pub fn transfer_officer(&mut self, new_officer: Address) {
        self.assert_compliance_officer();
        self.compliance_officer.set(new_officer);
    }

    // ── Read entry points ───────────────────────────────────────────────────

    /// Return the full investor record.
    pub fn get_investor(&self, investor: Address) -> InvestorRecord {
        self.investors.get_or_default(&investor)
    }

    /// Return true if the investor is verified, AML-clear, and KYC has not expired.
    pub fn is_eligible(&self, investor: Address) -> bool {
        let record = self.investors.get_or_default(&investor);
        record.is_verified
            && record.aml_clear
            && (record.kyc_expiry == 0 || record.kyc_expiry >= self.env().get_block_time())
    }

    /// Return the current compliance officer address.
    pub fn compliance_officer(&self) -> Address {
        self.compliance_officer
            .get_or_revert_with(RegistryError::Unauthorized)
    }

    /// Set an investor's risk band (0 = lowest risk). Only the compliance officer
    /// may call this. Added in the v2 upgrade — stored independently of
    /// InvestorRecord so existing installs can upgrade in place.
    pub fn set_risk_band(&mut self, investor: Address, risk_band: u8) {
        self.assert_compliance_officer();
        self.risk_bands.set(&investor, risk_band);
    }

    /// Return an investor's risk band (defaults to 0 if never set).
    pub fn get_risk_band(&self, investor: Address) -> u8 {
        self.risk_bands.get_or_default(&investor)
    }

    /// Contract version marker — observable proof that an in-place upgrade ran.
    pub fn contract_version(&self) -> String {
        "v2".to_string()
    }

    // ── Internal helpers ────────────────────────────────────────────────────

    #[inline]
    fn assert_compliance_officer(&self) {
        let officer = self
            .compliance_officer
            .get_or_revert_with(RegistryError::Unauthorized);
        if self.env().caller() != officer {
            self.env().revert(RegistryError::Unauthorized);
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, NoArgs};

    fn hk() -> JurisdictionCode {
        [b'H', b'K', 0]
    }

    #[test]
    fn test_upsert_and_get_investor() {
        let env = odra_test::env();
        let mut registry = IdentityRegistry::deploy(&env, NoArgs);

        let investor = env.get_account(1);
        let expiry: u64 = 9_999_999_999;

        registry.upsert_investor(investor, true, true, hk(), expiry);

        let record = registry.get_investor(investor);
        assert!(record.is_verified);
        assert!(record.aml_clear);
        assert_eq!(record.jurisdiction, hk());
        assert_eq!(record.kyc_expiry, expiry);
    }

    #[test]
    fn test_is_eligible() {
        let env = odra_test::env();
        let mut registry = IdentityRegistry::deploy(&env, NoArgs);

        let investor = env.get_account(1);
        registry.upsert_investor(investor, true, true, hk(), 9_999_999_999);

        assert!(registry.is_eligible(investor));
    }

    #[test]
    fn test_revoke_investor() {
        let env = odra_test::env();
        let mut registry = IdentityRegistry::deploy(&env, NoArgs);

        let investor = env.get_account(1);
        registry.upsert_investor(investor, true, true, hk(), 9_999_999_999);
        registry.revoke_investor(investor);

        assert!(!registry.is_eligible(investor));
    }

    #[test]
    fn test_unauthorized_reverts() {
        let env = odra_test::env();
        let mut registry = IdentityRegistry::deploy(&env, NoArgs);

        env.set_caller(env.get_account(1));
        let result = registry.try_upsert_investor(
            env.get_account(2),
            true,
            true,
            hk(),
            9_999_999_999,
        );
        assert!(result.is_err());
    }
}
