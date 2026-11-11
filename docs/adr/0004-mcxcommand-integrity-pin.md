# SPDX-PackageSummary: mcxRescue-live-build
# SPDX-FileCopyrightText: Copyright (C) 2025 Magna Capax Finland Oy
# SPDX-License-Identifier: CC-BY-SA-4.0

# ADR 0004: Optional integrity pin for mcxCommand (mcxSha256)

Status: Accepted
Date: 2026-11-11

## Context
ADR 0001 runs the script named by `mcxCommand=` as root and accepts any TLS
certificate. It left integrity as future hardening. Unattended OS installs now
start from mcxCommand: the downloaded script fetches an install engine and
rewrites disks. A stale or altered file on the artifact host would then run
with full control of the machine.

## Options Considered
- Strict TLS for the download: needs a CA bundle and correct time before
  network time sync, and still trusts whatever the artifact host serves.
- A hash of the script on the kernel cmdline, checked before running it.
- Signed scripts: needs a key in the image and a signing tool; more moving
  parts than the threat needs today.

## Decision
- New optional kernel parameter `mcxSha256=<64 hex digits>`.
- When present, the runner downloads the script to `/run`, compares its SHA-256
  with the pin, and runs it only on a match. A mismatch, or a pin that is not
  64 hex digits, logs one line and exits 1 without running anything.
- When absent, behaviour is exactly as in ADR 0001.
- Log lines carry the URL without its query string, and say whether the run was
  pinned.
- Strict TLS stays out of scope; `--no-check-certificate` is kept for the
  download because the pin, not the transport, carries integrity.

## Consequences
- Whoever controls DHCP/iPXE controls the cmdline and therefore the pin too, so
  the trust model of ADR 0001 is unchanged. The pin protects against a stale or
  altered file on the artifact host, not against a rogue boot server.
- The pinned script must itself verify anything it downloads (for example an
  install engine by its own hash).
- Old images without this change ignore `mcxSha256=` and run the script
  unverified; callers that need the pin must boot an image built after this ADR.

## References
- ADR 0001 (remote command via mcxCommand), which named this as future work.
- `files/hooks/mcxCommand`.
