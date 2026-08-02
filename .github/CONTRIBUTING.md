# Contributing to NexusRWA

Thanks for your interest in contributing! This project is a Casper Testnet
agentic RWA issuance prototype built for a buildathon submission.

## Getting Started

1. Fork the repository and clone your fork.
2. Install dependencies: `cd app && npm install`.
3. Copy `app/.env.local.example` (or create `app/.env.local`) and fill in the
   required Casper Testnet environment variables described in
   [README.md](../README.md).
4. Run the dev server: `npm run dev` from the `app/` directory.

## Repository Layout

- `app/src` — Next.js/TypeScript application (frontend + API routes).
- `app/contracts-casper` — Rust/Odra smart contracts (`compliance-oracle`,
  `identity-registry`, `token-coupon`) targeting Casper Testnet.
- `app/data` — Local JSON data used as source of truth for deployments and
  demo state (`deployments.json`, `subscriptions.json`, etc.).

## Making Changes

- Keep pull requests focused on a single change or fix.
- Run `npm run lint` and `npx tsc --noEmit` in `app/` before submitting.
- For contract changes, run the relevant `cargo odra test` suite under
  `app/contracts-casper/<contract>`.
- Do not commit secrets, private keys, or `.env.local` files.

## Reporting Issues

Please open a GitHub issue with steps to reproduce, expected behavior, and
actual behavior. For security issues, see [SECURITY.md](SECURITY.md) instead
of opening a public issue.

## Code Style

- TypeScript/React code follows the existing ESLint configuration
  (`app/eslint.config.mjs`).
- Rust contract code follows standard `rustfmt` conventions.
