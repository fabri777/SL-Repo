---
id: "SL-20260905-KEEP-CROSS-PLATFORM-BOOTSTRAP-LOGIC-THIN"
schemaVersion: 1
managedBy: "SL-Repo"
date: "2026-09-05"
kind: "win"
scope: "distribution"
status: "raw"
trigger:
  - "portable installer"
  - "cross-platform distribution"
hits: 0
retrievals: 0
lastVerifiedAt: "2026-09-05"
pinned: false
relatedTo: []
---

## Context
SL Repo needed one installation experience across Windows, macOS, and Linux,
including machines without a separately installed Node.js runtime.

## What worked
- Keep repository mutation and validation in the existing TypeScript CLI.
- Ship small platform-native acquisition scripts rather than duplicating SL
  behavior in PowerShell and POSIX shell.
- Package the compiled CLI, production dependencies, repository assets, and a
  private Node runtime in each native archive.
- Verify checksums and embedded release metadata before atomically selecting
  the installed version.

## Why
A PowerShell-only implementation adds a PowerShell 7 prerequisite outside
Windows, while separate full installers create behavior drift. Thin
bootstrappers preserve one tested implementation and portable runtime bundles
remove the system Node.js prerequisite without experimental executable
packagers.

## Re-use cue
- Retrieve when changing SL distribution, bootstrap scripts, release archives,
  runtime prerequisites, or cross-platform installation behavior.
