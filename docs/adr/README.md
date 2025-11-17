# SPDX-PackageSummary: mcxRescue-live-build
# SPDX-FileCopyrightText: Copyright (C) 2025 Magna Capax Finland Oy
# SPDX-License-Identifier: CC-BY-SA-4.0

# Architecture Decision Records (ADR)

ADRs capture significant technical decisions with their context, options, decision, and consequences. They help future contributors understand why a change was made and what trade‑offs were accepted.

Process
- One ADR decides one subject; keep scope tight and focused.
- Status values: Proposed → Accepted → (optionally) Deprecated → Superseded.
- Numbering: Use incremental IDs `NNNN-title.md` (e.g., `0001-iso-naming.md`).
- Index: Update `INDEX.md` with ID, title, and current status for discoverability.
- Cross‑reference: Link related ADRs and PRs.

When to write an ADR
- Changing artifact names, paths, or formats consumed by automation.
- Introducing or removing dependencies, runtimes, or build flows.
- Security, permission, or default‑behavior changes.
- Any change that would surprise a maintainer six months from now.

Template
- Use `0000-template.md` in this directory to author new ADRs.
