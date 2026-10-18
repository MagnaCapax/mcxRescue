# SPDX-PackageSummary: mcxRescue-live-build
# SPDX-FileCopyrightText: Copyright (C) 2026 Magna Capax Finland Oy
# SPDX-License-Identifier: CC-BY-SA-4.0

# ADR 0003: Architecture, layout and languages

Status: Accepted
Date: 2026-10-18

## Context
The MagnaCapax repositories share one set of engineering principles, with their reasons, in [`development/engineering-principles.md`](../../development/engineering-principles.md). Principle 1 says logic is written in PHP, shell is only thin glue of about 20 lines, and there is no Python; a repository whose runtime cannot run PHP records that exception and its capability reason in an ADR.

This repository is mostly shell, carries inherited Python, and had no record of its architecture beyond the expected layout in `AGENTS.md`. Without one, a contributor cannot tell which shell is a real exception, which is just glue, and which is upstream code this fork does not own. ADR 0001 (mcxCommand) and ADR 0002 (preloading mcxForge and mcxTemplate) cover single features, not the whole.

## Options Considered
- Leave it implicit in `AGENTS.md` and the code. No new text, but the next contributor copies the nearest file, which is shell or Python.
- Rewrite the build in PHP to match principle 1. Rejected: the build host has no PHP, the build is upstream finnix-live-build, and rewriting it would turn a thin fork into a separate product to maintain.
- Record the actual architecture, which parts are exceptions to principle 1 and why, and which are not (chosen).

## Decision
**What it is.** A fork of Finnix's finnix-live-build, a thin wrapper around Debian Live's live-build, rebranded as mcxRescue (`PRODUCT` and `PRODUCT_ID` default to `mcxRescue` in `finnix-live-build`). It builds a Debian live ISO (`mcxRescue-amd64.hybrid.iso` on amd64) for bare-metal servers, and from the same tree a container variant (`Dockerfile`, `DOCKER_BUILD=true`). On top of upstream it adds the kernel-command-line runner `mcxCommand` (ADR 0001), the loaders that place mcxForge in `/opt/mcxForge` and mcxTemplate in `/opt/mcxRescue` at build and at boot (ADR 0002), root shell helpers for mcxForge in `files/hooks/bash_profile`, and extra packages, among them `php-cli`, `php-curl` and `php-mbstring` for mcxForge.

**Layout and ownership.**
- `finnix-live-build`: the build orchestrator (upstream, POSIX sh). It renders templates, prepares the live-build config, runs live-build, and with `LINT=true` runs the lint path instead.
- `hooks/`: live-build hooks, `*.hook.chroot` (run inside the image during the build) and `*.hook.binary`, named `NNNN-<origin>-NNNN-<name>`, where the origin is `finnix` for upstream hooks and `mcxRescue` for ours. They are Jinja templates (`{{ PRODUCT_ID }}`).
- `files/`: what hooks install into the image. `files/hooks/` holds helpers and systemd units (ours: `mcxCommand`, `load-mcxforge`, `load-mcxtemplate` and their `.service` files); also boot themes (`grub/`, `syslinux/`), manpages (`manpages/`), container build files (`docker/`) and keyrings.
- `lists/`: the package lists live-build installs.
- `tools/`: build-host helpers from upstream (templating, dependency listing, command-not-found data, strace reordering).
- `live-build/`: the upstream live-build git submodule.
- `docs/`: `linting-and-ci.md` and the decision records in `docs/adr/`. `development/`: the contributor docs, including the principles.
- `.github/workflows/`: lint and build (`ci.yml`), `pre-commit.yml`, `release.yml`, `schedule.yml`. `.rrpcid/`: an upstream CI job.

**Languages, and the exceptions to principle 1.**
- *Exception, by capability: the build host and the initramfs.* `finnix-live-build` and `tools/` run on the build host before the image exists, and the host's declared dependencies (`build-dependencies.json`: debootstrap, python3, python3-jinja2, pandoc and others) include no PHP. The initramfs boot scripts (`initramfs-machine-id`, `initramfs-strace-init`, installed under `/etc/initramfs-tools/scripts/`) run inside the initramfs at boot, and no initramfs hook here copies PHP into it. These stay shell.
- *Exception, by ownership: inherited upstream code.* The Python files (`tools/*`, `files/hooks/cmdline-passwd`, `command-not-found`, `interfaces-convert`, `strings`, and the `9900` recompress hook) and the 615-line `finnix-live-build` itself come from upstream Finnix, as their SPDX headers say. `AGENTS.md` keeps this fork close to upstream, so they are kept as they are and not rewritten in another language. They are not a precedent: Python stays limited to the files that already use it, and mcxRescue's own code adds none.
- *Not an exception: our hooks and boot helpers.* PHP is available where they run. The package lists install `php-cli`, and hook files reach the chroot through live-build's `includes.chroot_after_packages`, so the chroot hooks and the booted image both have PHP. Our hooks (14 to 22 lines: install a file, enable a unit, preload a repository) are glue, which is shell's job. Our boot helpers are POSIX sh of 62 to 79 lines, mostly command orchestration (download, `git clone` or `pull`, retries) with a little parsing of `/proc/cmdline` and lease files. Principle 1 applies to them in full: when one of them gains logic, the logic moves to PHP, preferably into mcxForge, which is where on-host PHP tooling lives.
- No new runtime without an ADR.

**Build, run, test.**
- Build: on Debian testing or sid, or Ubuntu 20.04 or later, install the host packages (`tools/get-dependencies`), check out the submodule, and run `./finnix-live-build` as root. Output goes under `build/` (live-build in `build/lb/`).
- Lint: `make lint` (`env LINT=true ./finnix-live-build`): shellcheck and shfmt (`-ln=posix -i 4`), flake8, the 80-column pandoc reflow of the root, `.rrpcid` and manpage Markdown (not `AGENTS.md`, not `docs/`), and a diff of the rendered hook templates. `pre-commit run --all-files`: whitespace and end of file, executable bits, JSON and YAML, `reuse`, actionlint, black and flake8.
- CI: `ci.yml` runs the lint path and builds amd64 and arm64 images on every push and pull request; `pre-commit.yml` runs pre-commit.
- There is no unit test suite. The test for an image change is a build and a boot.

**Conventions in force.** lowerCamelCase for repository-defined identifiers (`mcxCommand`, `mcxCommand.service`); `UPPER_SNAKE_CASE` only for environment variables (`MCX_COMMAND`); installed helpers in `/usr/lib/${PRODUCT_ID}`, units in `/etc/systemd/system`; an SPDX header on every file; hooks and oneshot services idempotent, never blocking `multi-user.target`, with a `TimeoutStartSec`; one concise log line per step; Conventional Commits; ADRs numbered `NNNN-title.md`, the directory listing as the index.

**How the principles apply.**
- 1, PHP for logic: as above.
- 2, files around 150 lines: all mcxRescue-authored scripts are under 80 lines. The large files are upstream.
- 3, names from broad to specific in camelCase: the lowerCamelCase rule in `AGENTS.md` (`mcxCommand`) is this rule.
- 4 and 5, KISS, DRY, YAGNI and delete first: `AGENTS.md` already asks for configuration over code and a single build path; ADR 0002 reuses the boot loaders for the build-time preload rather than adding a second path.
- 6, pit of success: hooks default to on and degrade gracefully instead of hiding work behind kernel-command-line switches.
- 7, never break old users: artifact names and paths are consumed by automation and change only with an ADR (`AGENTS.md`).
- 8, tests that can fail: here the lint path, the build and a boot are the tests; a failing lint is a failure, not a warning.
- 9, decisions written down: ADRs as `AGENTS.md` describes.
- 10, fail soft: the boot helpers log and continue rather than block the boot.

## Consequences
- A contributor can tell, from one record, which shell is a capability exception, which is upstream code, and which is glue that must stay small.
- New mcxRescue logic has a clear home: PHP, preferably in mcxForge, not a growing boot script.
- Upstream merges stay cheap because inherited files keep their language and shape.
- Known defect at the time of writing: `files/hooks/load-mcxforge` fails a shell syntax check (`while ... ; then` where `do` is meant), so the mcxForge preload and the boot-time loader cannot run as committed. It is left for a separate fix.

## References
- ADR 0001 — Remote command via mcxCommand — Accepted
- ADR 0002 — Preload mcxForge and mcxTemplate at build — Proposed
- [`development/engineering-principles.md`](../../development/engineering-principles.md), [`docs/linting-and-ci.md`](../linting-and-ci.md), `AGENTS.md`
- Upstream: https://github.com/finnix/finnix-live-build
