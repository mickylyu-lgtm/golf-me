// Resource sampling for the local Caddie V2 eval tools: wall time, CPU time,
// and peak resident memory of this Node process plus every child process
// (headless Chromium and its helpers, ffmpeg). Linux /proc only (WSL
// included); elsewhere it reports only what Node itself can see. Sampled, so
// a child that lives less than one interval may be missed: numbers are
// indicative, not exact. Records hardware class only (CPU model, core count,
// memory), never hostnames, user names, or paths.
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";

/** Parses /proc/<pid>/stat. The command name may contain spaces and parentheses. */
export function parseProcStat(text) {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const pid = Number(text.slice(0, open).trim());
  const comm = text.slice(open + 1, close);
  const rest = text.slice(close + 2).trim().split(/\s+/);
  // rest[0] is field 3 (state); utime is field 14, stime 15, ppid 4.
  const ppid = Number(rest[1]);
  const utime = Number(rest[11]);
  const stime = Number(rest[12]);
  if (![pid, ppid, utime, stime].every(Number.isFinite)) return null;
  return { pid, comm, ppid, utimeTicks: utime, stimeTicks: stime };
}

/** VmRSS from /proc/<pid>/status, in bytes, or null. */
export function parseStatusRss(text) {
  const m = /^VmRSS:\s+(\d+)\s+kB/m.exec(text);
  return m ? Number(m[1]) * 1024 : null;
}

/** Groups a process command name into a coarse role for the report. */
export function processRole(comm) {
  const c = comm.toLowerCase();
  if (c.includes("ffmpeg")) return "ffmpeg";
  if (c.includes("chrom") || c.includes("headless") || c.includes("renderer") || c.includes("gpu-process")) return "chromium";
  if (c === "node" || c.startsWith("node")) return "node";
  return "other";
}

function clockTicks() {
  try {
    const r = spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8", timeout: 2000 });
    const n = Number(r.stdout.trim());
    return Number.isFinite(n) && n > 0 ? n : 100;
  } catch {
    return 100;
  }
}

function readProcTable() {
  const table = new Map();
  for (const name of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const st = parseProcStat(fs.readFileSync(`/proc/${name}/stat`, "utf8"));
      if (st) table.set(st.pid, st);
    } catch {
      // process exited between readdir and read
    }
  }
  return table;
}

function descendants(table, rootPid) {
  const children = new Map();
  for (const p of table.values()) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p.pid);
  }
  const out = [];
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    if (!table.has(pid)) continue;
    out.push(pid);
    for (const c of children.get(pid) ?? []) stack.push(c);
  }
  return out;
}

export function hardwareSummary() {
  const cpus = os.cpus();
  return {
    platform: os.platform(),
    wsl: os.release().toLowerCase().includes("microsoft"),
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() ?? null,
    logicalCores: cpus.length,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
  };
}

/**
 * Starts sampling. Call stop() to get the summary:
 * { wallSeconds, cpuSeconds: { total, node, chromium, ffmpeg, other },
 *   avgCoresBusy, peakRssBytes: { total, node, chromium, ffmpeg }, samples, procfs }.
 */
export function startResourceMonitor({ intervalMs = 200, rootPid = process.pid } = {}) {
  const procfs = os.platform() === "linux" && fs.existsSync("/proc/self/stat");
  const hz = procfs ? clockTicks() : 100;
  const t0 = process.hrtime.bigint();
  const nodeCpu0 = process.cpuUsage();
  const lastCpu = new Map(); // pid -> { role, ticks }
  const baseline = new Map(); // pid -> ticks at first sight, for processes that pre-date the run
  const peak = { total: 0, node: 0, chromium: 0, ffmpeg: 0, other: 0 };
  let samples = 0;

  function sample() {
    samples++;
    peak.node = Math.max(peak.node, process.memoryUsage().rss);
    if (!procfs) return;
    const table = readProcTable();
    const sums = { total: 0, node: 0, chromium: 0, ffmpeg: 0, other: 0 };
    for (const pid of descendants(table, rootPid)) {
      const p = table.get(pid);
      const role = pid === rootPid ? "node" : processRole(p.comm);
      const ticks = p.utimeTicks + p.stimeTicks;
      if (!baseline.has(pid)) baseline.set(pid, pid === rootPid ? ticks : 0);
      lastCpu.set(pid, { role, ticks });
      let rss = null;
      try {
        rss = parseStatusRss(fs.readFileSync(`/proc/${pid}/status`, "utf8"));
      } catch {
        // exited
      }
      if (rss !== null) {
        sums.total += rss;
        sums[role] += rss;
      }
    }
    for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], sums[k] ?? 0);
  }

  sample();
  const timer = setInterval(sample, intervalMs);
  timer.unref();

  return {
    /** Lets callers register a child the moment it spawns (sampled anyway). */
    sampleNow: sample,
    stop() {
      clearInterval(timer);
      sample();
      const wallSeconds = Number(process.hrtime.bigint() - t0) / 1e9;
      const nodeCpu = process.cpuUsage(nodeCpu0);
      const cpu = { total: 0, node: (nodeCpu.user + nodeCpu.system) / 1e6, chromium: 0, ffmpeg: 0, other: 0 };
      for (const [pid, { role, ticks }] of lastCpu) {
        if (role === "node" && pid === rootPid) continue;
        const sec = (ticks - (baseline.get(pid) ?? 0)) / hz;
        cpu[role] += sec;
      }
      cpu.total = cpu.node + cpu.chromium + cpu.ffmpeg + cpu.other;
      const round = (v) => Math.round(v * 1000) / 1000;
      return {
        wallSeconds: round(wallSeconds),
        cpuSeconds: Object.fromEntries(Object.entries(cpu).map(([k, v]) => [k, round(v)])),
        avgCoresBusy: wallSeconds > 0 ? round(cpu.total / wallSeconds) : null,
        peakRssBytes: procfs ? { ...peak } : { node: peak.node, total: null, chromium: null, ffmpeg: null, other: null },
        samples,
        intervalMs,
        procfs,
        note: "Sampled; children living under one interval may be missed. Peak total is the largest simultaneous sum.",
      };
    },
  };
}
