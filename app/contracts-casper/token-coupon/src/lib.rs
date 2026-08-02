// TokenCoupon — Casper/Odra RWA issuance, coupon metadata, and investor token credit.
//
// This contract stores the issuance evidence needed by the frontend and records
// subscription credits after off-chain/API-confirmed CSPR payments. It is not a
// full CEP-18 implementation yet; it is the minimal RWA balance ledger needed
// for the buildathon demo.

#![cfg_attr(target_arch = "wasm32", no_std)]

use odra::prelude::*;

#[odra::odra_type]
#[derive(Default)]
pub struct IssuanceMetadata {
    pub asset_id: String,
    pub asset_name: String,
    pub symbol: String,
    pub issuer: String,
    pub total_issuance: String,
    pub currency: String,
    pub sfc_ref: String,
    pub compliance_oracle_hash: String,
    pub identity_registry_hash: String,
    pub created_at: u64,
}

#[odra::odra_type]
#[derive(Default)]
pub struct CouponRecord {
    pub payment_date: String,
    pub amount_per_token: String,
    pub currency: String,
    pub recorded_at: u64,
}

#[odra::odra_type]
#[derive(Default)]
pub struct SubscriptionRecord {
    pub amount: u64,
    pub payment_ref: String,
    pub recorded_at: u64,
}

#[odra::event]
pub struct IssuanceInitialized {
    pub asset_id: String,
    pub symbol: String,
    pub issuer: String,
    pub sfc_ref: String,
}

#[odra::event]
pub struct CouponRecorded {
    pub payment_date: String,
    pub amount_per_token: String,
    pub currency: String,
}

#[odra::event]
pub struct TokensMinted {
    pub to: Address,
    pub amount: u64,
    pub payment_ref: String,
}

#[odra::event]
pub struct SubscriptionRecorded {
    pub investor: Address,
    pub amount: u64,
    pub payment_ref: String,
}

#[odra::event]
pub struct MintAuthorityChanged {
    pub new_authority: Address,
}

#[odra::odra_error]
pub enum TokenCouponError {
    Unauthorized = 1,
    InvalidAmount = 2,
    DuplicatePaymentRef = 3,
    Overflow = 4,
}

#[odra::module(events = [
    IssuanceInitialized,
    CouponRecorded,
    TokensMinted,
    SubscriptionRecorded,
    MintAuthorityChanged
])]
pub struct TokenCoupon {
    owner: Var<Address>,
    mint_authority: Var<Address>,
    asset_id: Var<String>,
    asset_name: Var<String>,
    symbol: Var<String>,
    issuer: Var<String>,
    total_issuance: Var<String>,
    currency: Var<String>,
    sfc_ref: Var<String>,
    compliance_oracle_hash: Var<String>,
    identity_registry_hash: Var<String>,
    created_at: Var<u64>,
    coupons: Mapping<String, CouponRecord>,
    balances: Mapping<Address, u64>,
    total_minted: Var<u64>,
    subscriptions: Mapping<String, SubscriptionRecord>,
    used_payment_refs: Mapping<String, bool>,
}

#[odra::module]
impl TokenCoupon {
    pub fn init(
        &mut self,
        asset_id: String,
        asset_name: String,
        symbol: String,
        issuer: String,
        total_issuance: String,
        currency: String,
        sfc_ref: String,
        compliance_oracle_hash: String,
        identity_registry_hash: String,
        mint_authority: Address,
    ) {
        self.owner.set(self.env().caller());
        self.mint_authority.set(mint_authority);
        self.asset_id.set(asset_id.clone());
        self.asset_name.set(asset_name);
        self.symbol.set(symbol.clone());
        self.issuer.set(issuer.clone());
        self.total_issuance.set(total_issuance);
        self.currency.set(currency);
        self.sfc_ref.set(sfc_ref.clone());
        self.compliance_oracle_hash.set(compliance_oracle_hash);
        self.identity_registry_hash.set(identity_registry_hash);
        self.created_at.set(self.env().get_block_time());
        self.total_minted.set(0);

        self.env().emit_event(IssuanceInitialized {
            asset_id,
            symbol,
            issuer,
            sfc_ref,
        });
    }

    pub fn record_coupon(
        &mut self,
        payment_date: String,
        amount_per_token: String,
        currency: String,
    ) {
        self.assert_owner();
        let record = CouponRecord {
            payment_date: payment_date.clone(),
            amount_per_token: amount_per_token.clone(),
            currency: currency.clone(),
            recorded_at: self.env().get_block_time(),
        };
        self.coupons.set(&payment_date, record);
        self.env().emit_event(CouponRecorded {
            payment_date,
            amount_per_token,
            currency,
        });
    }

    /// Admin/mint-authority credit for back-office corrections or migrations.
    pub fn mint_to(&mut self, to: Address, amount: u64, payment_ref: String) {
        self.mint_impl(to, amount, payment_ref);
    }

    /// Subscription credit after the backend has confirmed a native CSPR payment.
    pub fn subscribe(&mut self, investor: Address, amount: u64, payment_ref: String) {
        self.mint_impl(investor, amount, payment_ref);
    }

    /// Explicit purchase-settlement alias for integrations that prefer RWA wording.
    pub fn settle_purchase(&mut self, investor: Address, amount: u64, payment_ref: String) {
        self.mint_impl(investor, amount, payment_ref);
    }

    pub fn transfer_ownership(&mut self, new_owner: Address) {
        self.assert_owner();
        self.owner.set(new_owner);
    }

    pub fn set_mint_authority(&mut self, new_authority: Address) {
        self.assert_owner();
        self.mint_authority.set(new_authority);
        self.env().emit_event(MintAuthorityChanged { new_authority });
    }

    pub fn get_metadata(&self) -> IssuanceMetadata {
        IssuanceMetadata {
            asset_id: self.asset_id.get_or_default(),
            asset_name: self.asset_name.get_or_default(),
            symbol: self.symbol.get_or_default(),
            issuer: self.issuer.get_or_default(),
            total_issuance: self.total_issuance.get_or_default(),
            currency: self.currency.get_or_default(),
            sfc_ref: self.sfc_ref.get_or_default(),
            compliance_oracle_hash: self.compliance_oracle_hash.get_or_default(),
            identity_registry_hash: self.identity_registry_hash.get_or_default(),
            created_at: self.created_at.get_or_default(),
        }
    }

    pub fn get_coupon(&self, payment_date: String) -> CouponRecord {
        self.coupons.get_or_default(&payment_date)
    }

    pub fn get_subscription(&self, payment_ref: String) -> SubscriptionRecord {
        self.subscriptions.get_or_default(&payment_ref)
    }

    pub fn balance_of(&self, investor: Address) -> u64 {
        self.balances.get_or_default(&investor)
    }

    pub fn total_minted(&self) -> u64 {
        self.total_minted.get_or_default()
    }

    pub fn owner(&self) -> Address {
        self.owner.get_or_revert_with(TokenCouponError::Unauthorized)
    }

    pub fn mint_authority(&self) -> Address {
        self.mint_authority
            .get_or_revert_with(TokenCouponError::Unauthorized)
    }

    #[inline]
    fn mint_impl(&mut self, investor: Address, amount: u64, payment_ref: String) {
        self.assert_minter_or_owner();
        if amount == 0 || payment_ref.is_empty() {
            self.env().revert(TokenCouponError::InvalidAmount);
        }
        if self.used_payment_refs.get_or_default(&payment_ref) {
            self.env().revert(TokenCouponError::DuplicatePaymentRef);
        }

        let balance = self.balances.get_or_default(&investor);
        let new_balance = balance
            .checked_add(amount)
            .unwrap_or_else(|| self.env().revert(TokenCouponError::Overflow));
        let minted = self.total_minted.get_or_default();
        let new_total = minted
            .checked_add(amount)
            .unwrap_or_else(|| self.env().revert(TokenCouponError::Overflow));
        let recorded_at = self.env().get_block_time();

        self.balances.set(&investor, new_balance);
        self.total_minted.set(new_total);
        self.used_payment_refs.set(&payment_ref, true);
        self.subscriptions.set(&payment_ref, SubscriptionRecord {
            amount,
            payment_ref: payment_ref.clone(),
            recorded_at,
        });

        self.env().emit_event(TokensMinted {
            to: investor,
            amount,
            payment_ref: payment_ref.clone(),
        });
        self.env().emit_event(SubscriptionRecorded {
            investor,
            amount,
            payment_ref,
        });
    }

    #[inline]
    fn assert_owner(&self) {
        let owner = self.owner.get_or_revert_with(TokenCouponError::Unauthorized);
        if self.env().caller() != owner {
            self.env().revert(TokenCouponError::Unauthorized);
        }
    }

    #[inline]
    fn assert_minter_or_owner(&self) {
        let caller = self.env().caller();
        let owner = self.owner.get_or_revert_with(TokenCouponError::Unauthorized);
        let minter = self
            .mint_authority
            .get_or_revert_with(TokenCouponError::Unauthorized);
        if caller != owner && caller != minter {
            self.env().revert(TokenCouponError::Unauthorized);
        }
    }
}
