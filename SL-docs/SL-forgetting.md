# SL forgetting

Default evidence retention:

- Mark unused raw or distilled evidence stale after 90 days.
- Quarantine it after 180 days without successful reuse.
- Delete it after 30 days in quarantine.
- Explicitly wrong knowledge is deactivated and quarantined immediately, then
  becomes eligible for deletion after 7 days.

Promoted instructions and skills use a 365-day verification horizon because
automatic instruction usage is not reliably observable.

Before deletion, SL checks ownership, pinning, active references, source
evidence, registry consistency, and the quarantine grace period. Every
transition is appended to `SL-events.jsonl`, and deleted content remains
recoverable from Git history.
