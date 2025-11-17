# SPDX-PackageSummary: mcxRescue-live-build
# SPDX-FileCopyrightText: Copyright (C) 2025 Magna Capax Finland Oy
# SPDX-License-Identifier: CC-BY-SA-4.0

# Repository Guidelines (mcxRescue)
# AGENTS.md — Rails and Constitution

## Governing Law & Sources of Truth
- AGENTS.md is the governing law for contributions to this repository.
- Code is the ground truth for behavior; docs clarify intent. If docs and code disagree, follow the code and update the docs.
- Material changes to behavior, interfaces, security, or workflows require an ADR under `docs/adr/` (one subject per ADR; cross‑reference related ADRs).

## Generic Doctrine (Always Applies)
- KISS: Keep implementations simple and obvious; avoid unnecessary abstraction.
- DRY: Reuse existing helpers and hooks; centralize repeated patterns.
- YAGNI: Don’t build features, toggles, or abstractions until they are needed.
- Minimal Edits: Keep diffs small, cohesive, and reviewable; prefer deletion and simplification.
- Stability Over Perfection: Prefer incremental improvements that preserve working flows.
- One Flow, No Special Cases: Maintain a single explicit build path. Exceptions require a plan and a rollback/removal path.
- Pit of Success: Safe defaults; risky or debug paths must be explicit and noisy.
- Avoid New Stacks: Use POSIX shell for hooks, Bash as needed; Python only where already used (templating, helpers). Introducing new runtimes requires approval.
- No Aliases: Keep identifiers, environment variables, and filenames consistent. Avoid alternate names for the same concept.
- Backward Compatibility: Don’t break existing automation/consumers (e.g., artifact names, paths) without an ADR and migration plan.
- Always Attempt Completion: Never skip required work behind optional gates (e.g., kernel cmdline). Attempt the job unconditionally and degrade gracefully; only skip on explicit user opt‑out or when truly impossible.

## Repo‑Specific Adaptations (Finnix live‑build fork)
- Upstream Alignment: This is a thin wrapper around Debian Live’s live‑build (Finnix). Prefer configuration over code; avoid upstream divergence without clear rationale.
- Artifacts: ISO filenames derive from `${PRODUCT_ID}-${ARCH}` (default `mcxRescue`), e.g., `mcxRescue-amd64.hybrid.iso`. Keep CI/release/schedule globs aligned with this.
- Hooks: Keep chroot/binary hooks idempotent and explicit. Do not hide required work behind kernel cmdline gating; default to “on” and handle failures gracefully.
- Services & Paths: Place installed helpers under `/usr/lib/${PRODUCT_ID}` and units under `/etc/systemd/system`. Respect templating variables.
- Languages & Dependencies: Do not introduce new language runtimes; keep hook dependencies minimal and documented.

## Live Boot Hooks (Operational Rules)
- Idempotency:
  - Hooks and oneshot services must be safe on retries (no data loss; rerunnable without side effects). The mcxTemplate loader satisfies this.
- Failure Mode:
  - On missing network or dependencies, fail with clear log output. Do not block reaching multi‑user target; attempt the job regardless and degrade gracefully.
- Timeouts:
  - Ensure oneshot services have a reasonable `TimeoutStartSec` (e.g., 90s) to avoid boot stalls.
- Logging:
  - Emit concise, single‑line status messages to stdout/stderr (journal) for traceability.

## Repository Layout (Expected)
- `finnix-live-build`: Entrypoint orchestrating templating and live‑build.
- `hooks/`: Live‑build chroot/binary hooks (templated).
- `files/`: Assets copied into the image (systemd units, boot themes, manpages, Docker helpers).
- `lists/`: Package lists for live‑build.
- `tools/`: Helper scripts (e.g., Jinja2 renderer, dependency tools).
- `live-build/`: Upstream live‑build submodule.
- Lint/config: `.pre-commit-config.yaml`, `.yamllint.yml`, `pyproject.toml`.
- Docs: `docs/adr/` for decision records (see below).

## Commit & PR Rules
- Conventional Commit style: `type(scope): summary`
  - Types: `feat`, `fix`, `docs`, `ci`, `build`, `refactor`, `chore`, `revert`.
  - Summary <= 72 chars; imperative mood; no trailing period.
  - Body explains the why, impact, and risks; reference ADR IDs if applicable.
  - Separate logical changes into separate commits; avoid drive‑by edits.
- PR Checklist (minimum):
  - Reason for change stated clearly; impact on build/artifacts explained.
  - Pre‑commit passes; SPDX headers present in new files.
  - For behavior/interface changes: ADR added and referenced.
  - Local build sanity check performed (or CI matrix covers it).

## ADR Process (docs/adr)
- One ADR decides one subject; include context, options, decision, consequences.
- Status values: `Proposed`, `Accepted`, `Deprecated`, `Superseded` (must reference successor).
- Numbering: Incremental `NNNN-title.md` (e.g., `0001-iso-naming.md`); update the index.
- Index: Maintain `docs/adr/INDEX.md` listing ADR IDs, titles, and status.
- Template: Use `docs/adr/0000-template.md` to author new ADRs.

## Code Style & Tooling
- Shell: POSIX‑compatible; prefer `set -e` and explicit error handling. Run ShellCheck when available.
- Python: Follow `black` and `flake8` per `pyproject.toml`.
- YAML/JSON: Keep formatting consistent; `yamllint` and `check-json` run via pre‑commit.
- Licensing: Maintain SPDX headers; validated by `reuse` in pre‑commit.

## Contribution Rails
- Start with least change; unify flows rather than adding new options.
- Respect upstream mechanisms; prefer configuration over new code paths.
- Keep scope tight: this repository builds images; avoid application/server logic here.
- Document new behavior in this file and via ADR when applicable.

## Quick Maintainer Checklist
1) Keep the change minimal; delete or simplify when possible.
2) Reuse existing helpers; avoid duplication.
3) Build once locally (for your target arch) and sanity‑check the ISO.
4) Update docs/ADR as needed; reference ADR in commits/PR.
5) Ensure pre‑commit passes and SPDX headers are present.

This document activates the generic rules (KISS, DRY, YAGNI, Minimal Edits, Stability‑first) for mcxRescue while staying aligned with upstream live‑build.
