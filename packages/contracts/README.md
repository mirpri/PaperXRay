# @paper-xray/contracts

The three contracts referenced throughout `docs/01-nabcd-architecture.md` and
`docs/02-decisions.md`, defined once and shared by both `apps/web` and
`apps/server`. Nothing in this package depends on Node or DOM APIs — it's
pure types plus the code-point helpers, so it can be imported unmodified in
either runtime.

| File | Contract | Notes |
| --- | --- | --- |
| `src/ir.ts` | IR: `Document`, `Node`, `CharMap` | `CharMap` representation (`CharMapRun[]`) is a first cut — the architecture doc explicitly leaves this open; expect it to be revisited once the reassembly layer has real PDF fixtures to test against. |
| `src/annotation.ts` | `HumanAnnotation` / `AgentAnnotation` | Two different lifecycles, not two views of one type. Human annotations are mutable append-only threads with optimistic locking; agent annotations are immutable and grouped by `runId`. |
| `src/lens.ts` | `LensSpec` | What a user fills in to define a lens. Declarative scope + instruction + output schema, not an open prompt box. |

## Hard invariants encoded here

- **`CharRange` counts Unicode code points, never UTF-16 code units.**
  (`docs/02-decisions.md` #12). Use `toCodePoints` / `codePointLength` /
  `sliceByCodePoints` from `src/codepoints.ts` — never `str[i]` or
  `str.length` — anywhere a `CharRange` is produced or consumed. This
  matters the moment a paper's normalized text contains an astral-plane
  math symbol or certain CJK extension characters; without this rule the
  bug only reproduces on those papers and is very hard to track down.
- **`AgentAnnotation` has no `updatedAt`/`deletedAt`.** That's deliberate,
  not an oversight — see `docs/01-nabcd-architecture.md` "agent 层与人类层
  分离". To "edit" an agent annotation, rerun the lens and produce a new
  `runId`.
- **`evidenceSpan` is required on every `AgentAnnotation`.** The server is
  the only party allowed to decide it's valid — `docs/02-decisions.md` #6
  is explicit that client-side checks are a fast pre-check only.

## Why a separate `CharRange` type instead of `[number, number]`

Named fields (`start`/`end`) make "is this inclusive/exclusive" and "which
unit" greppable at every call site, and give the code-point invariant above
somewhere to be documented right next to the type.
