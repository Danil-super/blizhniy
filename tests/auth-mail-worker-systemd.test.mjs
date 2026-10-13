import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("mail service is an unprivileged bounded oneshot, never part of HTTP startup, with completion-based polling", () => {
  const service = readFileSync(new URL("../ops/systemd/blizhniy-auth-mail.service", import.meta.url), "utf8");
  const timer = readFileSync(new URL("../ops/systemd/blizhniy-auth-mail.timer", import.meta.url), "utf8");
  for (const directive of ["Type=oneshot", "User=blizhniy-mail", "Group=blizhniy-mail", "NoNewPrivileges=true",
    "EnvironmentFile=/etc/blizhniy/mail-worker/worker.env", "TimeoutStartSec=120", "TimeoutStopSec=45", "MemoryMax=256M",
    "MemorySwapMax=0", "TasksMax=32", "ProtectSystem=strict", "ProtectHome=true", "LimitCORE=0"]) assert.ok(service.includes(directive));
  assert.match(service, /ExecStart=\/opt\/blizhniy-node22\/bin\/node .*\/scripts\/auth-mail-worker\.mjs --run/);
  assert.equal(service.includes("Restart="), false); assert.equal(service.includes("Password="), false);
  assert.ok(timer.includes("OnUnitInactiveSec=15s")); assert.equal(timer.includes("OnUnitActiveSec="), false);
  assert.ok(timer.includes("Unit=blizhniy-auth-mail.service"));
});
test("systemd accepts the actual service/timer directives with only the fixture Node executable path substituted", () => {
  const directory = mkdtempSync(join(tmpdir(), "blizhniy-mail-unit-fixture-"));
  try {
    const service = readFileSync(new URL("../ops/systemd/blizhniy-auth-mail.service", import.meta.url), "utf8")
      .replace("/opt/blizhniy-node22/bin/node", process.execPath);
    const serviceFile = join(directory, "blizhniy-auth-mail.service"), timerFile = join(directory, "blizhniy-auth-mail.timer");
    writeFileSync(serviceFile, service); writeFileSync(timerFile, readFileSync(new URL("../ops/systemd/blizhniy-auth-mail.timer", import.meta.url)));
    execFileSync("systemd-analyze", ["verify", "--man=no", serviceFile, timerFile], { timeout: 5000, maxBuffer: 16384 });
  } finally { rmSync(directory, { recursive: true }); }
});
