# Vendored runtime code

The chain tests etch these onto a local Anvil node with `anvil_setCode`, so the CreateX path runs against the real
contract instead of Lattice's `MockCreateX` (whose codehash fails NET-01) and Multicall3 batches run against the
real `aggregate3`. Each file is the contract's deployed runtime code as `0x`-prefixed hex, one line.

| File | Address | keccak256 of the bytes |
| --- | --- | --- |
| `CreateX.runtime.hex` | `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` | `0xbd8a7ea8cfca7b4e5f5041d7d4b17bc317c5ce42cfbc42066a00cf26b43eb53f` (core's `CREATEX_CODEHASH`) |
| `Multicall3.runtime.hex` | `0xcA11bde05977b3631167028862bE2a173976CA11` | `0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891` |

Provenance: read on 2026-09-23 with `cast code <address> --rpc-url <public Sepolia RPC>` (Foundry 1.8.3) near Sepolia
block 11765379. Both codehashes were cross-checked with `cast codehash` on Ethereum mainnet, where they are the same.
Reads only: no transaction was sent anywhere.

`harness/vendor.ts` refuses to etch a file whose keccak256 differs from the table above, and
`createx.chain.test.ts` checks both again.
