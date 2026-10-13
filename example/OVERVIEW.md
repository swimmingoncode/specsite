---
title: Tidepool overview
---

# Tidepool overview

A plain-language reading of the [specification](SPEC.md). It defines nothing; every identifier below
points back to where it is defined.

Tidepool keeps values under keys (REQ-KV-1) and writes every change to a log first (REQ-LOG-1), so the
log alone can rebuild the store (`INV-2`). The plan's first decision, `DEC-1`, fixes the log format.

- `US-A1` is the story that matters most: restoring from the log.
- Open: `OQ-1`, access control.
