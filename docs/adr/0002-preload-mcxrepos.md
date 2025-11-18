# SPDX-PackageSummary: mcxRescue-live-build
# SPDX-FileCopyrightText: Copyright (C) 2025 Magna Capax Finland Oy
# SPDX-License-Identifier: CC-BY-SA-4.0

# ADR 0002: Preload mcxForge and mcxTemplate at build

Status: Proposed
Date: 2025-11-18

## Context
mcxRescue relies on two Git-based components at runtime:

- mcxForge: tools and helpers installed under `/opt/mcxForge`.
- mcxTemplate: the mcxRescue template engine under `/opt/mcxRescue`.

Initially, both were fetched only at boot time via oneshot systemd units
(`load-mcxforge.service`, `load-mcxtemplate.service`) that clone or update
from public Git hosting.

This has several downsides:

- First boot depends entirely on network and remote Git availability.
- Users may see transient "could not resolve host" errors early in boot while
  the system is still converging to `network-online`.
- mcxForge-provided tools are not present on the ISO filesystem; they only
  appear after a successful boot-time fetch.

At the same time, hooks and services must:

- Be idempotent and safe on retries.
- Never block reaching `multi-user.target`.
- Fail forward with clear logs when network or dependencies are missing.

## Options Considered
- Option A — Boot-time fetch only
  Keep the existing behavior: no build-time fetch, only systemd loaders that
  clone/update on every boot.

- Option B — Build-time preload only
  Clone mcxForge/mcxTemplate into `/opt` during live-build and remove the
  boot-time loaders, relying entirely on the baked-in state.

- Option C — Build-time preload plus boot-time update (Chosen)
  During live-build, best-effort preload mcxForge/mcxTemplate into `/opt`
  using the same loader scripts as boot, but never fail the build if this
  fetch fails. At boot, keep the existing oneshot services so they update
  the preloaded repositories or clone them if missing.

## Decision
Choose Option C: best-effort preload at build plus update at boot.

Implementation details:

- The mcxForge chroot hook (`0005-mcxRescue-1000-mcxforge-loader.hook.chroot`)
  now installs `/usr/lib/${PRODUCT_ID}/load-mcxforge` and then invokes it
  once inside the chroot with a minimal retry budget:

  - `MCXFORGE_RETRIES` defaults to `1` and `MCXFORGE_RETRY_DELAY` to `5`
    seconds for the build-time preload.
  - Failures are logged as
    `"mcxforge-loader: preload failed; will retry at boot"` and do not fail
    the live-build.

- The mcxTemplate chroot hook
  (`0005-mcxRescue-1000-mcxtemplate-loader.hook.chroot`) mirrors this
  behavior for `/usr/lib/${PRODUCT_ID}/load-mcxtemplate` with
  `MCXTEMPLATE_RETRIES` and `MCXTEMPLATE_RETRY_DELAY`.

- The boot-time oneshot services and loader helpers remain responsible for:

  - Ensuring `/opt/mcxForge` and `/opt/mcxRescue` exist.
  - Performing fast-forward `git pull` updates when a checkout already exists.
  - Cloning fresh checkouts if preloading failed or there is no `.git`.

This keeps a single source of truth for clone/update behavior (the loader
scripts under `/usr/lib/${PRODUCT_ID}`) and avoids introducing a separate
preload-only code path.

## Consequences
Positive:

- Many mcxRescue ISOs will ship with mcxForge and mcxTemplate already present
  under `/opt`, improving first-boot experience and making bash helpers usable
  immediately after login.
- Boot-time loaders become mostly update operations, reducing the amount of
  work required when the system is already running.
- The preload reuses existing loader logic, avoiding duplicated code and
  keeping behavior centralized.
- Build failures are not caused by transient network or Git host issues,
  thanks to the fail-forward preload design.

Negative / Risks:

- Live-build now performs network access to external Git hosting when possible.
  In fully offline build environments, the preload will always fail and log,
  though boot-time behavior remains unchanged.
- The ISO may contain a slightly outdated snapshot of mcxForge/mcxTemplate
  relative to the time of boot; the boot-time update mitigates this but does
  not guarantee success if the network is unavailable then.

Neutral:

- The oneshot services remain required to ensure that long-lived media can
  refresh mcxForge/mcxTemplate over time.

## References
- ADR 0001 — Remote command via mcxCommand — Accepted
- `hooks/0005-mcxRescue-1000-mcxforge-loader.hook.chroot`
- `hooks/0005-mcxRescue-1000-mcxtemplate-loader.hook.chroot`
- `files/hooks/load-mcxforge`
- `files/hooks/load-mcxtemplate`
