---
applyTo: "SL-src/**/*.ts,SL-tests/**/*.ts,SL-schemas/**/*.json,SL-templates/**/*"
---

# SL implementation rules

- Normalize persisted paths to `/`.
- Use UTC timestamps.
- Keep index output deterministic and omit changing generation timestamps.
- Every mutation supports dry-run where practical.
- Fail closed when ownership or deletion eligibility is ambiguous.
- Do not silently catch validation or filesystem failures.
