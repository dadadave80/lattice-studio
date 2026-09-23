# Metadata overlay

What Lattice's source states but no compiler artifact carries (spec decision 3): requirements, families, default
owners, facet inits and init details. `bun run catalog` reads it with `packages/catalog-gen/src/overlay.ts`, checks
it with `overlay-lint.ts` and folds it into the catalog. The overlay says nothing Lattice doesn't: every fact
cites the Lattice source it comes from, at the pinned commit (`lattice/` submodule).

```
overlay/
├─ facets/<area>.yaml     per facet: summary, requires, family, defaultOwnerOf, init, seamReview, notes   (CG5)
├─ inits/<area>.yaml      per init: kind, params, after, sameCall, sequence, registersInterfaces          (CG5)
├─ seams.yaml             seams (CG6)
└─ recipes/<Name>.yaml    recipe templates (CG6)
```

`<area>` is one of `access accounts amm crosschain defi diamond ens governance oracles privacy security tokens
utils`, read from the source path: `src/<area>/…`; diamond-lib and `src/Receive.sol` are `diamond`.

## Rules

- **Cite everything that comes from Lattice** as `source: <path>#L<a>-L<b>`, a path in the Lattice checkout and an
  inclusive line range (`#L26-L26` for one line). The lint fails a citation past the end of its file.
- **A fact you can't cite is a guess: leave it out.** List it for review instead.
- **Quote** every selector (`"0x06fdde03"`) and every example (`"300"`): YAML reads `0x…` and bare digits as numbers.
- Copy follows the spec's voice: US spelling, sentence case, no "please", no exclamation marks. `reason` is a
  lowercase clause that reads after "VaultCore requires ERC4626: ".

## `facets/<area>.yaml`

```yaml
VaultCore:
  summary:                     # optional: only when the NatSpec notice is missing or wrong
    text: Strategy-aware ERC-4626 vault core.
    source: src/defi/VaultCore.sol#L12-L14
  requires:                    # required once reviewed; [] means "reviewed, none apply"
    - anyOf: [ERC4626]         # the facets that satisfy it, preferred first
      strength: hard           # hard: DEP-01 blocker · convention: DEP-02 warning (a usual companion)
      reason: it runs the assets behind ERC4626's shares and initializes after it
      source: src/defi/libraries/VaultCoreLib.sol#L64-L65
  family:                      # optional: upgrade | access | account (one member per diamond)
    name: upgrade
    source: src/governance/AccessControlDiamondCut.sol#L16-L19
  defaultOwnerOf:              # optional: selectors this facet wins when a contender is placed too
    - selectors: ["0x01e1d114"]
      source: docs/guides/compose-your-own-diamond.md#L40-L42
  init:                        # optional: the init that must run when the facet is placed (INIT-04)
    name: VaultCoreInit
    source: src/defi/VaultCoreInit.sol#L17-L30
  seamReview: >-               # required when the facet shares a selector with another facet
    totalAssets is a seam in GovernedVault (seams.yaml); its other shared selectors aren't.
  notes: Free text for maintainers.
```

- `requires`: only what the source states. Role writers carry no `requires` on AccessControl: C3 derives the
  namespace warning from `touches` against `storage.id`, so nothing is reported twice (contracts §4). That rule
  fires only for access-family owners, so any other pairing the source states (ERC20Votes and Votes) needs its
  own `requires` entry.
- `init`: the facet's own init contract, when Lattice ships one. INIT-04 is satisfied by any plan step that
  initializes the same modules (GovernedVaultInit covers ERC20's `init`).
- `seamReview`: what you checked about the shared selectors. The seams themselves live in `seams.yaml` (CG6).

## `inits/<area>.yaml`

```yaml
GovernedDiamondCutInit:        # the contract; `<Contract>.<fn>` only with two or more usable entry points
                               # (EIP-7702-only ones such as AccountInit.init7702 are left out, contracts §3.1)
  kind: step                   # step | bundle (one call whose internal order is fixed in Solidity)
  source: src/governance/GovernedDiamondCutInit.sol#L19-L33   # the init function
  registersInterfaces: true    # only when the init itself calls DiamondLib.registerInterface()
  params:
    admin:
      doc: The address granted DEFAULT_ADMIN_ROLE.   # optional: replaces a missing or unclear @param
      # Studio's rule: say so in a comment when the source doesn't enforce it itself.
      rule: nonzero            # range(a,b) gt(n) gte(n) nonzero maxlen(n) code(safe|token|contract) enum(a|b|c), joined with &
      unit: seconds            # seconds | percent | wei, integers only
      authority: true          # receives a role, ownership or upgrade rights; needs `role`
      role: DEFAULT_ADMIN_ROLE
      source: src/governance/GovernedDiamondCutInit.sol#L24-L28   # required with rule, unit or authority
      example: "2"             # optional, with exampleSource: "studio" or the Lattice caller it comes from
      exampleSource: studio
      components: {}           # a tuple's fields, by name, in the same shape
  after:                       # modules that must be initialized earlier; an init that runs one itself satisfies it
    - module: AccessControl
      source: src/governance/libraries/GovernedDiamondCutLib.sol#L113-L114
  sameCall:                    # modules that must initialize in the same initialize() call
    - module: ERC20
      source: src/tokens/ERC20/libraries/ERC20VotesLib.sol#L37-L38
  sequence:                    # bundles only: the internal order, shown read-only
    modules: [AccessControl, EmergencyStop]
    source: src/defi/GovernedVaultInit.sol#L44-L87
```

Signatures, parameter types, NatSpec and `initializes` come from the build (CG4); the overlay adds only the above.

## Lint

```sh
bun packages/catalog-gen/test/cg5/lint-cli.ts [area…] [--errors]
```

Errors fail the build: unknown facets, inits, params, selectors or modules; bad rules or units; an entry in the
wrong area's file; two default owners for one selector; a citation past the end of its file; copy that breaks the
voice rules. Warnings list what a facet or init still lacks (summary, requirements review, seam review, init
docs), so a new facet in `FacetInventory` shows up without failing the build (spec L911).
