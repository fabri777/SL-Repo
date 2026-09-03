# SL security model

SL data is committed to Git and must be safe for every reader of the
repository.

- Reject common token, password, private-key, and connection-string patterns.
- Reject absolute paths containing user profile names.
- Never export repository evidence automatically.
- Never classify model confidence as permission to delete.
- Only registry entries marked `managedBy: SL-Repo` are mutable by SL.
- Git branch protections remain authoritative.
