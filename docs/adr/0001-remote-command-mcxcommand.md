# SPDX-PackageSummary: mcxRescue-live-build
# SPDX-FileCopyrightText: Copyright (C) 2025 Magna Capax Finland Oy
# SPDX-License-Identifier: CC-BY-SA-4.0

# ADR 0001: Remote Command via mcxCommand

Status: Accepted
Date: 2025-11-17

## Context
We need a way to perform post-boot actions on bare-metal and seedbox servers booted via PXE/DHCP. The mechanism must be extremely simple, reliable in a DHCP-controlled /24, and minimize code/knobs to reduce failure modes and maintenance.

## Decision
- Kernel parameter: `mcxCommand` (lowerCamelCase). Value is an HTTPS URL pointing to a shell script.
- Execution point: after reaching multi-user target. We do not gate on `network-online`; in this environment DHCP/network is already up by the time we act.
  - Amended 2026-11-12: that premise is false. Once the unit stopped
    deadlocking (Type=exec, below), it started before DHCP had finished
    and its single `wget` failed. Gating on `network-online.target` does
    not help either, because the systemd hook clears
    `network-online.target.wants`. The runner instead retries the
    download every 5 s for up to 300 s (15 s timeout per attempt), then
    fails with one log line giving the attempt count.
- Runner: a tiny POSIX shell helper `/usr/lib/${PRODUCT_ID}/mcxCommand` invoked by `mcxCommand.service` with `ConditionKernelCommandLine=|mcxCommand`.
- Behavior: download and execute the script, YABS-style:
  - `wget -qO- --no-check-certificate "$mcxCommand" | bash`
  - Accept self-signed certs (controlled /24; DHCP compromise implies total compromise).
- Environment (best-effort, optional): export a small set for the script’s convenience:
  - `MCX_COMMAND`, `MCX_PRODUCT_ID`, `MCX_HOSTNAME`, `MCX_ARCH`, `MCX_IFACE`, `MCX_IP4`, `MCX_DHCP_SERVER`.
- Last-at-boot approximation: the runner waits for `systemctl is-system-running --wait` if available before executing, to defer until the system reaches the `running`/`degraded` state.
  - The unit is `Type=exec`, never `Type=oneshot` (2026-11-12). A oneshot start job stays open until the script exits, and the system stays `starting` while any start job is open, so the wait never returns. Observed on a 12c3a09 image: `mcxCommand.service` "activating" for over 5 minutes, `systemctl list-jobs` showing only its own start job and `multi-user.target` waiting on it. The `load-mcxtemplate` and `load-mcxforge` units used the same wait as oneshots and were killed by their 90 s start timeout before doing any work; they are `Type=exec` too.
- Logging: emit one start line and one completion line with return code to the journal. No status callbacks.

## Consequences
- Operationally simple; remote script has full control.
- Minimal local code; fewer failure points; easy to reason about.
- Trust model is DHCP/iPXE; accepting self-signed HTTPS is acceptable in the controlled network.
- Idempotency is the responsibility of the remote script.
- Future hardening (if needed) could add optional integrity (e.g., `mcxSha256`) or strict TLS. That would require a follow-up ADR. ADR 0004 added the optional `mcxSha256` pin (2026-11-11).

## Alternatives Considered
- Extra parameters (status URL, args, timeouts): rejected as option creep; simplicity wins.
- JSON POST status and richer telemetry: rejected; logs are sufficient for now.
 - Long-running agents/daemons: rejected; unnecessary complexity and attack surface.
