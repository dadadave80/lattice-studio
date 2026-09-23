# Security

Lattice Studio's checks run inside the same bundle that a compromised build would ship. That's the limit stated plainly: an in-app check can prove a plan is internally consistent, but it can't prove the app itself wasn't tampered with. Three paths don't depend on trusting the app at all:

- **The Foundry script.** Exported scripts are standalone and readable before running: no FFI, a header naming the recipe hash, catalog tag, and Studio version, and an on-chain refusal to broadcast if a codehash, an empty address, or the simulated routing doesn't check out.
- **The catalog.** Anyone can rebuild it from the pinned Lattice tag and compare hashes: `bun packages/cli/src/main.ts verify-catalog --lattice <checkout>` (see `docs/release.md`).
- **LatticeRegistry**, where a chain has one: the factory re-verifies a registered facet's codehash and selectors on-chain before cutting it in.

## What the in-app checks can and can't prove

| Can prove | Can't prove |
| --- | --- |
| The recipe has no unresolved selector collisions, every seam routes to an allowed facet, and every literal authority address was confirmed | That the frontend serving those checks is the real one — a compromised build ships its own expected values |
| A shared contract's on-chain `extcodehash` matches the catalog, checked right before signing | That the catalog itself was built from the Lattice tag it claims — only an independent `verify-catalog` rebuild proves that |
| After deploy, `facets()` matches the plan exactly, or the record is marked Mismatch and never Live | That a custom RPC isn't lying about what it reports — a custom chain is always labeled "Unverified network" |

## Threats and mitigations, in short

| Threat | Mitigation |
| --- | --- |
| A compromised frontend swaps a facet address or codehash | Independent roots: the Foundry script, the catalog hash, and, for whole registered facets, on-chain re-verification through LatticeRegistry |
| A buggy frontend or a stale catalog routes wrong | Every shared contract's `extcodehash` is checked against the catalog before signing and after deploy |
| The registry's "latest" pointer moves between review and signing | Studio never sends version 0 ("latest"); every export and review shows the exact pinned version |
| Someone takes a predicted address first | Addresses commit to their bytecode (Arachnid's proxy); the diamond factory folds the deploying account into the salt, so a taken address can only hold the real code |
| A share link or file carries hostile content | Strict schema validation, names rendered as text only, opening never runs anything; an authority address that came from a link or file blocks deploy until confirmed in full |
| A literal address left over from another salt or chain gets authority | "This diamond" and "Deploying account" are references resolved when the transaction is built, not stored literals; a literal that matches an earlier prediction blocks |
| Injection into a generated Foundry script through a name | Every string goes through a Solidity string-literal encoder; names are sanitized; hostile names (quotes, newlines, `*/`, unicode) are covered by tests |
| Wallet phishing through the app | Studio never asks for a seed phrase or a key and never requests token approvals; the review shows decoded calldata and its hash |
| A compromised npm dependency | Frozen lockfile, few dependencies, reviewed updates, install scripts blocked by default, npm provenance on CLI releases, Subresource Integrity on every script and lazy chunk |
| Cross-site scripting | A strict Content Security Policy with no `unsafe-inline` and no `unsafe-eval`; the one inline style and the import map are allowed by hash, nothing else |
| Deploying unaudited code | Lattice and CreateX are both unaudited; mainnet deploys are off in v1 and, once enabled, carry an explicit typed confirmation naming the unaudited code |
| Clipboard confusion | Copy puts the exact checksummed value on the clipboard, and the confirmation echoes it in full |

## Privacy

No analytics and no error reporting unless enabled by the person using Studio. Share links live in the URL fragment, which a server never sees. RPC providers see the addresses Studio reads; Sourcify receives the sources it verifies, which are public anyway.

## Reporting a problem

Reporting isn't open yet: this repository has no public home, and no contact for a report has been agreed on.

**Needs David:** once this repository has a GitHub remote (`docs/release.md`), turn on private vulnerability reporting for it (Security → Report a vulnerability), and this section switches to pointing there.

Studio never asks for a seed phrase, a private key, or an RPC URL with a credential in it, and a real report never needs to include one either.
