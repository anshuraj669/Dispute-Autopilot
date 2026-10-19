// Import this first in any test that touches lib/store, lib/settings or the
// mock provider. Those modules resolve data/ from process.cwd() when they load,
// so moving into a fresh temp directory keeps tests away from the real data/.
// Node's test runner gives each test file its own process.

import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

process.chdir(mkdtempSync(path.join(tmpdir(), "dispute-autopilot-test-")));
process.env.PAYPAL_MODE = "mock";
process.env.MERCHANT_REFUND_POLICY = "Returns accepted within 30 days.";
