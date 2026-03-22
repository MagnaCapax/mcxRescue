# SPDX-PackageSummary: mcxRescue-live-build
# SPDX-FileCopyrightText: Copyright (C) 2026 Magna Capax Finland Oy
# SPDX-License-Identifier: CC-BY-SA-4.0

# ADR 0003: BMC BIOS Flash via Playwright Browser Automation

Status: Accepted
Date: 2026-03-22

## Context
Server motherboards with ASPEED AST2500 BMC chips (common in ASRock Rack, Gigabyte,
and other server boards) can reflash the BIOS SPI chip independently of the host CPU
via the BMC web UI. This capability is critical for recovery when the host CPU is dead
or stuck in a POST failure — the BMC operates on its own power domain and has direct
SPI bus access to the BIOS flash chip.

The AMI MegaRAC BMC firmware (tested: 1.80.00) does NOT expose BIOS update
functionality via its REST API — the maintenance endpoints return "Invalid API Call"
(error code 1010). The BIOS update can ONLY be performed through the browser-based
web UI, which is a single-page application (SPA) with hash-based routing, session
management via sessionStorage, and CSRF token validation.

This means automating BIOS flash requires a real browser. POSIX shell with curl
cannot drive the SPA login flow, sessionStorage population, file upload, or the
multi-step confirmation dialogs.

## Options Considered
- Option A — curl/wget shell script: impossible; the SPA requires JavaScript
  execution, sessionStorage, and browser-native file upload handling.
- Option B — Python + Selenium/Playwright: viable, but adds Python browser
  automation dependencies not currently in the repo.
- Option C — Node.js + Playwright: viable; Playwright handles Chromium lifecycle,
  self-signed certs, dialog auto-accept, and file input manipulation natively.

## Decision
Option C: Node.js + Playwright. This introduces a new runtime (Node.js) which
AGENTS.md discourages without approval. The approval rationale:

1. **No alternative exists** — the BMC SPA cannot be driven without a real browser
   engine. Shell tools cannot substitute.
2. **Scoped dependency** — the tool lives in `tools/bmcBiosFlash/` with its own
   `package.json`; it does not affect the live-build image or boot hooks.
3. **Operational value** — remote BIOS recovery avoids datacenter visits, saving
   hours of downtime per incident.
4. **Playwright is self-contained** — `npx playwright install chromium` fetches
   the browser binary; no system-level packages required beyond Node.js.

The tool is a standalone CLI utility, not part of the ISO build pipeline.

## Consequences
- **Positive:** Remote BIOS recovery capability for any AMI MegaRAC BMC with
  ASPEED AST2500 (and likely AST2600). Saves datacenter visits.
- **Positive:** Documented, repeatable process replaces manual browser clicking.
- **Negative:** Node.js runtime required on the operator's workstation (not on
  the target server or rescue image).
- **Negative:** Playwright downloads ~150MB Chromium binary on first run.
- **Neutral:** Tool is isolated in `tools/bmcBiosFlash/`; does not affect
  existing build pipeline or boot hooks.
- **Follow-up:** Test with AST2600 BMC firmware when hardware is available.

## References
- AMI MegaRAC SP-X BMC firmware documentation
- Playwright Node.js API: https://playwright.dev/docs/api/class-page
- ASRock Rack X570D4I-2T BMC firmware 1.80.00 (tested)
