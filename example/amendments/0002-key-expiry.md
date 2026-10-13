# 0002: Key expiry

Status: Draft

Add an optional time-to-live to `put` in `CTR-STORE`. An expired key reads as `ERR-NotFound` (`REQ-KV-2`).
