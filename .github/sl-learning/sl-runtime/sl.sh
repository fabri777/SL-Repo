#!/usr/bin/env bash
set -euo pipefail

if ! command -v pwsh >/dev/null 2>&1; then
  printf '%s\n' 'SL requires PowerShell 7.0.0 or newer (pwsh was not found).' >&2
  exit 3
fi

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec pwsh -NoLogo -NoProfile -File "$script_dir/sl.ps1" "$@"
