// 探针接线：spawn 已有 update-check.mjs，读 cache 打 stderr（逻辑对齐 wind-mcp-skill/cli.mjs）

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const UPDATE_CHECK_PATH = join(SKILL_DIR, "scripts", "update-check.mjs");
const UPDATE_STATE_FILE = join(homedir(), ".cache", "wind-aimarket", "update-state.json");

export function spawnUpdateCheck() {
  try {
    if (!existsSync(UPDATE_CHECK_PATH)) return;
    const child = spawn("node", [UPDATE_CHECK_PATH], {
      cwd: SKILL_DIR,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch {}
}

function getInstalledHashes() {
  const result = {};
  const candidates = new Set();
  const xdg = process.env.XDG_STATE_HOME;
  candidates.add(
    xdg
      ? join(xdg, "skills", ".skill-lock.json")
      : join(homedir(), ".agents", ".skill-lock.json"),
  );
  for (const start of [SKILL_DIR, process.cwd()]) {
    let dir = resolve(start);
    while (true) {
      candidates.add(join(dir, "skills-lock.json"));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const lockPath of candidates) {
    if (!existsSync(lockPath)) continue;
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      for (const [name, entry] of Object.entries(lock?.skills || {})) {
        const hash = entry?.skillFolderHash || entry?.computedHash;
        if (hash && !result[name]) result[name] = hash;
      }
    } catch {}
  }
  return result;
}

function filterAlreadyUpgraded(outdated) {
  const installed = getInstalledHashes();
  return outdated.filter((o) => {
    const live = installed[o.name];
    if (!live) return true;
    const cur = o.current || "";
    if (!cur) return true;
    return live.startsWith(cur);
  });
}

export function maybePrintUpdateNotice() {
  try {
    if (!existsSync(UPDATE_STATE_FILE)) return;
    const original = JSON.parse(readFileSync(UPDATE_STATE_FILE, "utf8"));
    let state = original;

    if (
      state.status === "update_available" &&
      Array.isArray(state.outdated) &&
      state.outdated.length > 0
    ) {
      const stillOutdated = filterAlreadyUpgraded(state.outdated);
      if (stillOutdated.length === 0) {
        state = {
          status: "up_to_date",
          ttlMs: 60 * 60 * 1000,
          lastCheck: new Date().toISOString(),
        };
        if (original.snoozedUntil) state.snoozedUntil = original.snoozedUntil;
        if (typeof original.snoozeLevel === "number") {
          state.snoozeLevel = original.snoozeLevel;
        }
        try {
          writeFileSync(UPDATE_STATE_FILE, JSON.stringify(state, null, 2));
        } catch {}
      } else if (stillOutdated.length < state.outdated.length) {
        state = { ...state, outdated: stillOutdated };
        try {
          writeFileSync(UPDATE_STATE_FILE, JSON.stringify(state, null, 2));
        } catch {}
      }
    }

    if (state.snoozedUntil && new Date(state.snoozedUntil) > new Date()) return;

    if (state.status === "update_available") {
      const lines = ["", `[wind-skills] 检测到 ${state.outdated.length} 个 skill 有新版:`];
      for (const o of state.outdated) {
        const isGitee =
          typeof o.sourceUrl === "string" && o.sourceUrl.includes("gitee.com");
        const upgradeCmd = isGitee
          ? `npx skills add ${o.sourceUrl} --skill ${o.name} -g -y  # Gitee 源不支持 update,需重装`
          : `npx skills update ${o.name} -g -y`;
        lines.push(`  • ${o.name.padEnd(34)} ${o.current || "?"} → ${o.latest}`);
        lines.push(`    升级: ${upgradeCmd}`);
      }
      lines.push("");
      process.stderr.write(lines.join("\n") + "\n");
      return;
    }

    if (state.status === "transient_error") {
      process.stderr.write(
        `\n[wind-skills] 检查更新失败,可能是网络问题(reason=${state.reason || "unknown"})\n\n`,
      );
      return;
    }

    if (state.status === "unknown") {
      process.stderr.write(
        `\n[wind-skills] 无法确认是否最新(reason=${state.reason || "unknown"})\n\n`,
      );
    }
  } catch {}
}
