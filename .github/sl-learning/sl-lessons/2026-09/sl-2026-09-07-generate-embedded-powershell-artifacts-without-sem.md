---
id: "SL-20260907-GENERATE-EMBEDDED-POWERSHELL-ARTIFACTS-WITHOUT-SEM"
schemaVersion: 1
managedBy: "sl"
date: "2026-09-07"
kind: "pitfall"
scope: "runtime-build"
status: "raw"
trigger:
  - "bundle PowerShell runtime"
  - "embed JSON in PowerShell"
  - "generate scripts containing dollar signs"
lastVerifiedAt: "2026-09-07"
pinned: false
relatedTo: []
---

## Context
The destination runtime build concatenates modular PowerShell fragments and
embeds canonical JSON conformance vectors into a generated module.

## What did NOT work
- Passing PowerShell source directly as a JavaScript `String.replace`
  replacement expanded `$` replacement tokens and inflated/corrupted the
  generated module.
- Parsing embedded ISO timestamps with bare `ConvertFrom-Json` materialized
  them as `System.DateTime`, changing canonical conformance output.

## Why
JavaScript replacement strings interpret dollar-sign sequences, while a
replacement callback returns source text literally. PowerShell JSON parsing
can coerce ISO date strings; when `DateKind` is supported, `-DateKind String`
preserves the cross-runtime JSON contract.

## Re-use cue
- Retrieve before generating PowerShell or shell code through JavaScript
  string substitution.
- Retrieve when embedding JSON whose string types must remain identical across
  TypeScript and PowerShell.
