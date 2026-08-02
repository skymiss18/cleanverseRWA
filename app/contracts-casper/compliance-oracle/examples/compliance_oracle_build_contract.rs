// build_contract binary — WASM entry point for ComplianceOracle
// Built via: cargo odra build -b casper
// (or: ODRA_MODULE=ComplianceOracle ODRA_BACKEND=casper cargo build --release --target wasm32-unknown-unknown --bin compliance_oracle_build_contract)
#![doc = "Binary for building wasm files from compliance-oracle contract."]
#![no_std]
#![no_main]
#![allow(unused_imports, clippy::single_component_path_imports)]
use compliance_oracle;
