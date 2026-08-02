// build_contract binary — WASM entry point for TokenCoupon
// Built via: cargo odra build -b casper
// (or: ODRA_MODULE=TokenCoupon ODRA_BACKEND=casper cargo build --release --target wasm32-unknown-unknown --bin token_coupon_build_contract)
#![doc = "Binary for building wasm files from token-coupon contract."]
#![no_std]
#![no_main]
#![allow(unused_imports, clippy::single_component_path_imports)]
use token_coupon;
