import { readFileSync } from "node:fs";

// This is a resource boundary, not a filesystem/network/privilege sandbox.
export function assertConstrainedMediaRuntime(unit) {
  if (process.platform !== "linux" || process.env.NODE_ENV !== "test" || !/^blizhniy-media-[0-9a-f-]{36}\.service$/.test(unit ?? "")) throw new Error("Media runtime unavailable");
  const group = readFileSync("/proc/self/cgroup", "utf8").trim();
  if (!group.startsWith("0::/") || !group.endsWith("/" + unit) || group.includes("..")) throw new Error("Media runtime unavailable");
  const root = "/sys/fs/cgroup" + group.slice(3);
  const read = name => readFileSync(root + "/" + name, "utf8").trim();
  const [quota, period] = read("cpu.max").split(/\s+/).map(Number);
  if (read("memory.max") !== "536870912" || read("memory.swap.max") !== "0" || read("pids.max") !== "32" || !Number.isFinite(quota) || quota <= 0 || !Number.isFinite(period) || period <= 0 || quota > period || !/^NoNewPrivs:\s+1$/m.test(readFileSync("/proc/self/status", "utf8"))) {
    throw new Error("Media runtime unavailable");
  }
}
