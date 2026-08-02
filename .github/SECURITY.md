# Security Policy

## Supported Versions

This repository is an active hackathon/buildathon submission targeting Casper
Testnet. There are no versioned releases; security fixes are applied to the
`main` branch.

| Branch | Supported |
|---|---|
| `main` | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability (including but not limited to smart
contract logic issues, API authentication/authorization gaps, or secret
exposure), please report it privately rather than opening a public issue:

- Open a [GitHub Security Advisory](../../security/advisories/new) for this
  repository, or
- Contact the maintainer listed in [SUPPORT.md](SUPPORT.md).

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a proof-of-concept if available.
- Any suggested remediation.

We aim to acknowledge reports within a reasonable timeframe and will keep
reporters updated as the issue is triaged and resolved.

## Scope Notes

- Smart contracts under `app/contracts-casper/` are deployed to **Casper
  Testnet only** for this submission; they do not hold real-value mainnet
  funds.
- Never commit `.env.local`, private keys, or other secrets. If a secret is
  accidentally committed, rotate it immediately and report it via the process
  above.
