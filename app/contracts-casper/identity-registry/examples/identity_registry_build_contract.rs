// build_contract binary — WASM entry point for IdentityRegistry
// Built via: cargo odra build -b casper
// (or: ODRA_MODULE=IdentityRegistry ODRA_BACKEND=casper cargo build --release --target wasm32-unknown-unknown --bin identity_registry_build_contract)
#![doc = "Binary for building wasm files from identity-registry contract."]
#![no_std]
#![no_main]
#![allow(unused_imports, clippy::single_component_path_imports)]
use identity_registry;
