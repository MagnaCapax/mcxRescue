#!/usr/bin/env node

// SPDX-PackageSummary: mcxRescue-live-build
// SPDX-FileCopyrightText: Copyright (C) 2026 Magna Capax Finland Oy
// SPDX-License-Identifier: MPL-2.0

// bmcBiosFlash — Remote BIOS reflash via AMI MegaRAC BMC web UI
//
// Automates the full BIOS update flow on ASPEED AST2500/AST2600 BMCs running
// AMI MegaRAC firmware. The BMC's REST API does not support BIOS updates
// (returns error 1010 "Invalid API Call" on firmware <=1.80), so this tool
// drives the browser-based SPA directly via Playwright.
//
// The BMC's ASPEED chip operates on its own power domain with direct SPI bus
// access to the BIOS flash chip. This means BIOS can be reflashed even when
// the host CPU is completely dead (no POST, no screen output). The host CPU
// does not need to be running.
//
// Tested on:
//   - ASRock Rack X570D4I-2T, BMC firmware 1.80.00, ASPEED AST2500
//
// Should work on any AMI MegaRAC BMC with a Maintenance > BIOS Update page
// in the web UI (common on ASRock Rack, Gigabyte, Supermicro server boards).
//
// Usage:
//   node bmcBiosFlash.js <bmc-host> <user> <pass> <rom-file>
//
// Environment variables (optional):
//   BMC_FLASH_MODE   - Flash mode: "immediate" (default), "next_boot", "shutdown"
//   BMC_TIMEOUT_S    - Overall timeout in seconds (default: 900)
//   BMC_SCREENSHOT   - Set to "1" to save screenshots at each phase
//   BMC_HEADLESS     - Set to "0" for visible browser (default: "1", headless)
//
// Exit codes:
//   0 — BIOS flash completed successfully
//   1 — Usage error, login failure, or fatal error
//   2 — Upload failed or Proceed button never appeared
//   3 — Flash failed or error detected during write
//
// Security notes:
//   - BMC web UIs use self-signed HTTPS certificates; Chromium is launched
//     with --ignore-certificate-errors. This is expected and acceptable for
//     BMC management interfaces on trusted networks.
//   - Credentials are passed as CLI arguments. On multi-user systems, consider
//     using environment variables or a credentials file instead, as CLI args
//     are visible in /proc/<pid>/cmdline.
//   - This tool should only be run from a trusted management workstation on
//     the same network segment as the BMC.
//
// ADR: docs/adr/0003-bmc-bios-flash-playwright.md

"use strict";

const { chromium } = require("playwright");
const path = require("path");

// --- CLI argument parsing ---------------------------------------------------

const [bmcHost, bmcUser, bmcPass, romFile] = process.argv.slice(2);

if (!bmcHost || !bmcUser || !bmcPass || !romFile) {
  console.error(
    "Usage: node bmcBiosFlash.js <bmc-host> <user> <pass> <rom-file>"
  );
  console.error("");
  console.error("Environment variables:");
  console.error(
    "  BMC_FLASH_MODE   immediate|next_boot|shutdown (default: immediate)"
  );
  console.error("  BMC_TIMEOUT_S    overall timeout in seconds (default: 900)");
  console.error("  BMC_SCREENSHOT   1 to save screenshots (default: off)");
  console.error("  BMC_HEADLESS     0 for visible browser (default: 1)");
  process.exit(1);
}

// Basic host validation — prevent shell injection if someone wraps this
if (!/^[\w.\-:]+$/.test(bmcHost)) {
  console.error("Error: invalid BMC host format");
  process.exit(1);
}

// --- Configuration from environment -----------------------------------------

const FLASH_MODE = (process.env.BMC_FLASH_MODE || "immediate").toLowerCase();
const TIMEOUT_S = parseInt(process.env.BMC_TIMEOUT_S || "900", 10);
const SCREENSHOTS = process.env.BMC_SCREENSHOT === "1";
const HEADLESS = process.env.BMC_HEADLESS !== "0";

// Flash mode radio button IDs in the AMI MegaRAC BIOS Update page
const FLASH_MODE_MAP = {
  next_boot: "flash_on_next_boot", // value=1: flash after manual shutdown
  immediate: "flash_on_the_fly", // value=2: flash now, no power action
  shutdown: "shutdwon_host_to_flash", // value=3: shutdown then flash (note: BMC typo is real)
};

const flashRadioId = FLASH_MODE_MAP[FLASH_MODE];
if (!flashRadioId) {
  console.error(
    `Error: unknown BMC_FLASH_MODE "${FLASH_MODE}". Use: immediate, next_boot, shutdown`
  );
  process.exit(1);
}

// --- Logging ----------------------------------------------------------------

const log = (msg) =>
  console.error(`[${new Date().toISOString()}] ${msg}`);

// --- Main flow --------------------------------------------------------------

const chromiumArgs = ["--ignore-certificate-errors"];
if (process.getuid && process.getuid() === 0) {
  chromiumArgs.push("--no-sandbox");
}

(async () => {
  const browser = await chromium.launch({
    args: chromiumArgs,
    headless: HEADLESS,
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  let stepNum = 0;
  const screenshot = async (label) => {
    if (!SCREENSHOTS) return;
    stepNum++;
    const f = `/tmp/bios-flash-step${stepNum}-${label}.jpg`;
    await page.screenshot({ path: f, type: "jpeg", quality: 90, fullPage: true });
    log(`Screenshot: ${f}`);
  };

  // Auto-accept confirmation dialogs. The BMC BIOS Update page shows two:
  //   1. "We will start the BIOS update now..." after clicking Start
  //   2. "Clicking OK will start the actual upgrade..." after clicking Proceed
  page.on("dialog", async (dialog) => {
    log(`Dialog [${dialog.type()}]: ${dialog.message()}`);
    await dialog.accept();
  });

  // Overall timeout
  const deadline = Date.now() + TIMEOUT_S * 1000;
  const checkDeadline = () => {
    if (Date.now() > deadline) {
      throw new Error(`Overall timeout (${TIMEOUT_S}s) exceeded`);
    }
  };

  let garcToken = null;

  try {
    // === PHASE 1: Login =====================================================
    // The AMI MegaRAC SPA requires browser-based login. API-based cookie
    // injection does NOT work — the KVM WebSocket handshake and other features
    // validate session data that is only correctly established through the
    // browser SPA login flow. The SPA populates 12+ sessionStorage fields
    // over ~6-7 seconds after login.

    log("Phase 1: Login");
    await page.goto(`https://${bmcHost}/`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForSelector("#userid", { timeout: 10000 });
    await page.fill("#userid", bmcUser);
    await page.fill("#password", bmcPass);
    await page.press("#password", "Enter");

    // Wait for SPA to populate sessionStorage (CSRF token + feature flags)
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1000);
      const ready = await page.evaluate(
        () =>
          sessionStorage.getItem("garc") && sessionStorage.getItem("features")
      );
      if (ready) {
        log(`Session ready after ${i + 1}s`);
        break;
      }
    }

    garcToken = await page.evaluate(() => sessionStorage.getItem("garc"));
    if (!garcToken) {
      log("Login failed — session token not populated");
      await screenshot("login-failed");
      process.exit(1);
    }
    log("Logged in");
    await page.waitForTimeout(3000);

    // === PHASE 2: Navigate to BIOS Update ===================================
    // The SPA uses hash-based routing. The correct route is:
    //   #maintenance/bios_update  (underscore)
    // NOT #maintenance/bios-update (hyphen) — the hyphen variant silently
    // loads an empty content pane with no error.

    log("Phase 2: Navigate to BIOS Update");
    await page.click('a[href="#maintenance"]');
    await page.waitForTimeout(2000);
    await page.click('a[href="#maintenance/bios_update"]');
    await page.waitForTimeout(5000);
    await screenshot("bios-update-page");

    // === PHASE 3: Select flash mode =========================================
    // The page presents three radio buttons for flash behavior. When the host
    // CPU is dead, use "immediate" (flash_on_the_fly) — there is no running
    // OS to shut down.

    log(`Phase 3: Select flash mode "${FLASH_MODE}" (${flashRadioId})`);
    await page.evaluate((radioId) => {
      const radio = document.getElementById(radioId);
      if (radio) {
        radio.click();
        radio.checked = true;
      }
    }, flashRadioId);
    await page.waitForTimeout(500);

    // === PHASE 4: Upload ROM file ===========================================
    // The BIOS Update page has TWO file inputs:
    //   #file_PublicKey  (index 0, hidden) — for signed firmware encryption keys
    //   #fileBIOS_image  (index 1, visible) — for the actual BIOS ROM file
    //
    // Using the wrong input (index 0) results in a
    // "Please choose a BIOS image file" error.

    log("Phase 4: Upload ROM file");
    const fileInput = await page.$("#fileBIOS_image");
    if (!fileInput) {
      log("ERROR: #fileBIOS_image input not found — page may not have loaded");
      await screenshot("no-file-input");
      process.exit(2);
    }
    await fileInput.setInputFiles(path.resolve(romFile));
    await page.waitForTimeout(2000);

    const fileVal = await page.evaluate(() => {
      const inp = document.getElementById("fileBIOS_image");
      return inp ? { files: inp.files.length, value: inp.value } : null;
    });
    log(`File input state: ${JSON.stringify(fileVal)}`);
    await screenshot("file-selected");

    // === PHASE 5: Click Start BIOS Update ===================================
    // This triggers the first confirmation dialog (auto-accepted above) and
    // begins the ROM upload to the BMC.

    log("Phase 5: Click Start BIOS update");
    await page.click("#start");
    log("Upload started — waiting for completion...");

    // === PHASE 6: Wait for upload and click Proceed =========================
    // After upload reaches 100%, the page transforms to show:
    //   Current BIOS Version: <old>
    //   New BIOS Version: <new>
    //   [Proceed] [Cancel]
    //
    // Clicking Proceed triggers the second confirmation dialog and begins
    // the actual SPI flash write.

    log("Phase 6: Waiting for upload completion and Proceed button");
    let proceedClicked = false;
    for (let i = 0; i < 120; i++) {
      checkDeadline();
      await page.waitForTimeout(5000);

      const state = await page.evaluate(() => {
        const body = document.body.innerText;
        const proceedBtn = [...document.querySelectorAll("button")].find(
          (b) => b.textContent.trim() === "Proceed"
        );
        const match = body.match(/Uploading\.\.\.\s*(\d+)%/);
        return {
          uploadPercent: match ? parseInt(match[1]) : -1,
          hasProceed: !!proceedBtn,
          proceedVisible: proceedBtn ? proceedBtn.offsetParent !== null : false,
          hasCurrentBIOS: body.includes("Current BIOS Version"),
          hasNewBIOS: body.includes("New BIOS Version"),
        };
      });

      if (i % 3 === 0) {
        log(
          `Upload: ${state.uploadPercent}% | proceed=${state.hasProceed} | versions=${state.hasCurrentBIOS}`
        );
      }

      if (state.hasProceed && state.proceedVisible) {
        log("Upload complete — clicking Proceed");
        await screenshot("proceed-visible");
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll("button")].find(
            (b) => b.textContent.trim() === "Proceed"
          );
          if (btn) btn.click();
        });
        proceedClicked = true;
        log("Proceed clicked");
        await page.waitForTimeout(3000);
        await screenshot("after-proceed");
        break;
      }

      if (i % 12 === 11) await screenshot(`upload-${state.uploadPercent}pct`);
    }

    if (!proceedClicked) {
      log("ERROR: Proceed button never appeared — upload may have failed");
      await screenshot("no-proceed");
      process.exit(2);
    }

    // === PHASE 7: Monitor BIOS flash progress ===============================
    // The BMC writes directly to the SPI flash chip. Progress is reported as
    // percentages. Typical 32MB ROM flash takes ~2 minutes.

    log("Phase 7: Monitoring BIOS flash progress...");
    let flashResult = "unknown";
    for (let i = 0; i < 180; i++) {
      checkDeadline();
      await page.waitForTimeout(5000);

      const status = await page.evaluate(() => {
        const body = document.body.innerText;
        const spinner = document.getElementById("processing_layout");
        const processingText = document.getElementById("processing_text");
        const flashMatch = body.match(
          /(?:Flash|Upgrad|Writ|Eras)(?:ing|e)?\.\.\.\s*(\d+)%/i
        );
        return {
          processingVisible: spinner
            ? spinner.style.display !== "none"
            : false,
          processingMsg: processingText ? processingText.textContent : "",
          flashPercent: flashMatch ? parseInt(flashMatch[1]) : -1,
          hasComplete: /complet|success|finished|done/i.test(body),
          hasError: /(?:^|[^a-z])(?:error|fail(?:ed|ure)?)\b/i.test(body),
          hasStartButton: body.includes("Start BIOS update"),
          hasProceed: body.includes("Proceed"),
        };
      });

      if (i % 3 === 0) {
        log(
          `Flash: ${status.flashPercent}% | complete=${status.hasComplete} | error=${status.hasError} | processing=${status.processingVisible}`
        );
      }

      // Success: completion message and no spinner
      if (status.hasComplete && !status.processingVisible) {
        log("BIOS flash complete");
        await screenshot("flash-complete");
        flashResult = "complete";
        break;
      }

      // Success: page returned to initial state (BMC auto-returns after flash)
      if (
        status.hasStartButton &&
        !status.hasProceed &&
        !status.processingVisible &&
        i > 6
      ) {
        log("Page returned to initial state — flash likely complete");
        await screenshot("flash-done-reset");
        flashResult = "complete_reset";
        break;
      }

      // Failure: error detected
      if (status.hasError && !status.processingVisible && i > 3) {
        log("BIOS flash ERROR detected");
        await screenshot("flash-error");
        flashResult = "error";
        break;
      }

      if (i % 12 === 11) await screenshot(`flash-progress-${i}`);
    }

    // === Cleanup: release BMC session =======================================
    // The BMC allows ~4-5 concurrent sessions. Clean up to avoid exhausting
    // the session pool on repeated runs.

    try {
      await page.evaluate(async (token) => {
        await fetch("/api/session", {
          method: "DELETE",
          headers: { "X-CSRFTOKEN": token },
        });
      }, garcToken);
      log("Session released");
    } catch (_) {
      // Session cleanup is best-effort
    }

    // --- Exit ---------------------------------------------------------------

    switch (flashResult) {
      case "complete":
        console.log("BIOS_FLASH_COMPLETE");
        log("=== BIOS flash succeeded ===");
        process.exit(0);
        break;
      case "complete_reset":
        console.log("BIOS_FLASH_COMPLETE_RESET");
        log("=== BIOS flash succeeded (page reset) ===");
        process.exit(0);
        break;
      case "error":
        console.log("BIOS_FLASH_ERROR");
        log("=== BIOS flash FAILED ===");
        process.exit(3);
        break;
      default:
        console.log("BIOS_FLASH_TIMEOUT");
        log("=== BIOS flash timed out ===");
        process.exit(3);
    }
  } catch (err) {
    log(`Fatal error: ${err.message}`);
    await screenshot("fatal-error").catch(() => {});
    process.exit(1);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
