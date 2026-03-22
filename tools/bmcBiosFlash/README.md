<!--
SPDX-PackageSummary: mcxRescue-live-build
SPDX-FileCopyrightText: Copyright (C) 2026 Magna Capax Finland Oy
SPDX-License-Identifier: CC-BY-SA-4.0
-->

# bmcBiosFlash — Remote BIOS Reflash via BMC Web UI

Automates BIOS updates on server motherboards with ASPEED AST2500/AST2600 BMC
chips running AMI MegaRAC firmware, using Playwright browser automation.

## Why This Exists

The AMI MegaRAC BMC firmware (tested: 1.80.00) does **not** expose BIOS update
functionality via its REST API — maintenance endpoints return error 1010
("Invalid API Call"). The BIOS update can only be performed through the
browser-based web UI.

The BMC's ASPEED chip operates on its **own power domain** with direct SPI bus
access to the BIOS flash chip. This means BIOS can be reflashed even when the
host CPU is completely dead — no POST, no screen output, nothing. The host CPU
does not need to be running.

This tool drives the BMC web UI automatically: login → navigate → upload ROM →
confirm → monitor flash progress → report result.

## When To Use This

- Host CPU is dead or stuck in a POST failure loop
- BIOS corruption suspected after power event or failed update
- Need to downgrade/upgrade BIOS without physical access
- Any situation where the BMC is reachable but the host is not

## Prerequisites

- **Node.js** >= 18
- **Network access** to the BMC management interface (typically on a dedicated
  management VLAN or IPMI network)
- A BIOS ROM file for the target motherboard

## Setup

```bash
cd tools/bmcBiosFlash
npm install
npx playwright install chromium
```

## Usage

```bash
node bmcBiosFlash.js <bmc-host> <user> <pass> <rom-file>
```

### Example

```bash
node bmcBiosFlash.js 10.0.0.100 admin hunter2 /path/to/X574I2T2.14
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BMC_FLASH_MODE` | `immediate` | `immediate` — flash now (use when CPU is dead); `next_boot` — flash after manual shutdown; `shutdown` — shutdown host then flash |
| `BMC_TIMEOUT_S` | `900` | Overall timeout in seconds |
| `BMC_SCREENSHOT` | off | Set to `1` to save screenshots at each phase to `/tmp/` |
| `BMC_HEADLESS` | `1` | Set to `0` for visible browser (debugging) |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | BIOS flash completed successfully |
| 1 | Usage error, login failure, or fatal error |
| 2 | Upload failed or Proceed button never appeared |
| 3 | Flash failed or error detected during write |

On success, the tool prints `BIOS_FLASH_COMPLETE` (or `BIOS_FLASH_COMPLETE_RESET`)
to stdout. All progress logging goes to stderr.

## How It Works

### Phase 1: Login

The AMI MegaRAC SPA requires browser-based login. API-based cookie injection
does not work — the SPA populates 12+ `sessionStorage` fields over ~6-7 seconds
that are required for subsequent page navigation and CSRF protection.

### Phase 2: Navigate to BIOS Update

The SPA uses hash-based routing. The correct route is:
```
#maintenance/bios_update    ← underscore (correct)
#maintenance/bios-update    ← hyphen (WRONG — loads empty pane, no error)
```

### Phase 3: Select Flash Mode

Three radio buttons control flash behavior:
- `flash_on_next_boot` (value 1) — queue flash for next boot
- `flash_on_the_fly` (value 2) — flash immediately, no power action
- `shutdwon_host_to_flash` (value 3) — shutdown then flash (note: the typo
  in the element ID is real, present in the BMC firmware)

When the host CPU is dead, use `immediate` (default) — there is no running OS
to shut down.

### Phase 4: Upload ROM

The page has **two** file inputs:
- `#file_PublicKey` (index 0, **hidden**) — for firmware encryption keys
- `#fileBIOS_image` (index 1, visible) — for the actual BIOS ROM

Using the wrong input produces "Please choose a BIOS image file" with no
other indication of what went wrong.

### Phase 5–6: Start and Proceed

After clicking Start, the BMC uploads the ROM. At 100%, a Proceed/Cancel
screen appears showing current and new BIOS versions. Two confirmation
dialogs are auto-accepted.

### Phase 7: Flash

The BMC writes to the SPI flash chip. A typical 32MB ROM takes ~2 minutes.
Progress is shown as percentages. On completion, an alert reports success.

## Tested Hardware

| Board | BMC Chip | BMC Firmware | ROM Size | Result |
|-------|----------|-------------|----------|--------|
| ASRock Rack X570D4I-2T | ASPEED AST2500 | 1.80.00 | 32MB | Works |

Should work on any board using AMI MegaRAC with the standard BIOS Update
web UI page. Contributions and test reports for other boards are welcome.

## Security Notes

- BMC web UIs use self-signed HTTPS; Chromium is launched with
  `--ignore-certificate-errors`. This is standard for BMC management.
- Credentials are passed as CLI arguments. On multi-user systems, pass them
  via a wrapper script or environment variables instead.
- Run only from a trusted management workstation on the BMC network segment.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Login times out | BMC unreachable or wrong IP | Verify BMC IP with `ipmitool -I lanplus -H <ip> mc info` |
| "Please choose a BIOS image file" | Wrong file input targeted | Bug in script — should not happen with current version |
| Proceed button never appears | Upload failed silently | Check ROM file is correct for the board; try BMC_SCREENSHOT=1 |
| Flash percentage stuck | SPI write stalled | Wait for overall timeout; BMC may need a cold reset (`ipmitool mc reset cold`) |
| Page loads empty after navigation | Wrong hash route | Verify BMC firmware uses `#maintenance/bios_update` (underscore) |

## License

MPL-2.0 — see [LICENSE.md](../../LICENSE.md)

## ADR

See [docs/adr/0003-bmc-bios-flash-playwright.md](../../docs/adr/0003-bmc-bios-flash-playwright.md)
for the architectural decision to introduce Node.js/Playwright for this tool.
