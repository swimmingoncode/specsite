---
title: Tidepool plan
plan_version: 0.2.0
status: Draft
---

# Tidepool plan

How Tidepool would be built. Every item traces to the [specification](SPEC.md); where the two disagree,
the specification wins.

## Decisions

**`DEC-1`** The log is a single file of length-prefixed records, which satisfies `REQ-LOG-1` and keeps
`INV-1` checkable with one `fsync` per change.

**`DEC-2`** The store is rebuilt from the log at start-up (`REQ-LOG-2`, `INV-2`); there is no separate
snapshot file in the first version.

## Features

| ID | Feature | Covers |
| --- | --- | --- |
| `F-001` | Key-value API | `REQ-KV-1`, `REQ-KV-2`, `REQ-KV-3`, `CTR-STORE` |
| `F-002` | Audit log writer and replayer | `REQ-LOG-1`, `REQ-LOG-2`, `CTR-LOG` |
| `F-003` | Restore command | `US-A1`, `AC-A1.1`, `AC-A1.2` |

## Tests

| ID | Test | Checks |
| --- | --- | --- |
| `T-1` | Crash between append and acknowledge, then replay | `INV-1` |
| `T-2` | Replay twice from empty and compare | `INV-2` |

## Risks

The latency target `NFR-1` may not hold on network file systems; see [the requirement](SPEC.md#4-non-functional-requirements).
`REQ-KV-9` is mentioned here on purpose: it is not defined anywhere, so the build reports it.
