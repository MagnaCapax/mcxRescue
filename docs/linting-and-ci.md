# SPDX-PackageSummary: mcxRescue-live-build
# SPDX-FileCopyrightText: Copyright (C) 2025 Magna Capax Finland Oy
# SPDX-License-Identifier: CC-BY-SA-4.0

# Linting, CI, and Guardrails

This document captures the concrete lint and CI rules for mcxRescue and the
guardrails contributors must follow. Treat this as required reading together
with `AGENTS.md` before making changes.

## Pre-commit Hooks

Configured in `.pre-commit-config.yaml` and enforced in CI:

- Whitespace and EOF:
  - `end-of-file-fixer`: exactly one newline at EOF; no extra blank lines.
  - `trailing-whitespace`: no trailing spaces on any line (including Markdown).
- Scripts:
  - `check-executables-have-shebangs`: scripts marked executable must have a shebang.
  - `check-shebang-scripts-are-executable`: files with a shebang must be 0755 and tracked as such.
- Formats and metadata:
  - `check-json`, `check-yaml`: well-formed JSON/YAML.
  - `yamllint`: style and structure for YAML.
  - `reuse`: SPDX headers present and correct.
  - `actionlint`: GitHub Actions workflows are syntactically valid.
  - `black`, `flake8`: Python code formatted and lint-clean per `pyproject.toml`.

## finnix-live-build Lint Path (`make lint`)

`make lint` runs `env LINT=true ./finnix-live-build`, which enforces:

- Shell and formatting:
  - `shellcheck` on `finnix-live-build`, `hooks/*.hook.*`, and scripts under
    `tools/` and `.rrpcid/jobs/`.
  - `shfmt` where available for consistent shell formatting.
  - Known patterns to avoid:
    - `export VAR="$(cmd)"` masking return codes — assign then `export`.
    - `A && B || C` when `C` must not run if `A` succeeds — use explicit `if`.
- Markdown rendering:
  - All `*.md` (except `AGENTS.md`) are rendered via `render` and `pandoc` to
    gfm with 80-column reflow, then diffed.
  - Pandoc input format must be `gfm+smart` with `yaml_metadata_block`;
    deprecated formats such as `markdown_github` are not allowed.
- Hook templating:
  - `hooks/*.hook.*` are rendered into `LINT_DIR` and diffed. Template output
    must match the committed file. Avoid constructs that templating rewrites
    (e.g., spurious trailing backslashes).

## Known Failure Classes and Guardrails

- Whitespace:
  - Before committing, visually inspect new/edited Markdown and text using
    `nl -ba` to ensure:
    - No trailing spaces.
    - The file ends with a single newline after the last content line.
- Shell scripts:
  - Run `shellcheck` on any shell script touched and address warnings unless
    there is a deliberate `# shellcheck disable=...` with a short rationale.
  - Prefer explicit `if`/`else` branches over `&&/||` chains where behavior
    might be ambiguous.
- Executable bits:
  - After editing hooks or helpers under `hooks/` and `files/hooks/`, confirm
    that all shebang scripts are mode `100755` and tracked correctly.
- ADRs:
  - One ADR decides one subject.
  - No ADR index file; the directory listing is the index.
  - ADRs must obey the same whitespace and SPDX rules as other docs.

## Developer Workflow Guardrail

Before committing:

- Re-read `AGENTS.md` and this file for the repository rules.
- Run `pre-commit run --all-files` locally when available.
- For behavior changes, keep code, docs, and ADRs in the same logical change.
- Where possible, run `make lint` to exercise the finnix live-build lint path.

