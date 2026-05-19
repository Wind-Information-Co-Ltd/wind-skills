// 探针接线：spawn 已有 update-check.mjs，读 cache 打 stderr（逻辑对齐 wind-mcp-skill/cli.mjs）

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SKILL_NAME = basename(SKILL_DIR);
const UPDATE_CHECK_PATH = join(SKILL_DIR, "scripts", "update-check.mjs");
const UPDATE_STATE_FILE = join(homedir(), ".cache", "wind-aifinmarket", "update-state.json");

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
    // 优先用 lock 完整 hash 严格相等(update-check v2 写入 installedHash;
    // 适配 Gitee 装的 SHA-256 + GitHub 装的 SHA-1,两边同源同算法,严格相等总成立)
    if (o.installedHash) return live === o.installedHash;
    // 兼容旧 cache 条目:退化到 shortHash 前缀匹配
    const cur = o.current || "";
    if (!cur) return true;
    return live.startsWith(cur);
  });
}

function readCacheView() {
  if (!existsSync(UPDATE_STATE_FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(UPDATE_STATE_FILE, "utf8"));
    if (raw?.schemaVersion === 3 && raw?.skills && typeof raw.skills === "object") {
      return { raw, state: raw.skills[SKILL_NAME] || null, isV3: true };
    }
    return { raw, state: raw, isV3: false };
  } catch {
    return null;
  }
}

function writeCacheView(view, newState) {
  try {
    if (view.isV3) {
      view.raw.skills[SKILL_NAME] = newState;
      writeFileSync(UPDATE_STATE_FILE, JSON.stringify(view.raw, null, 2));
    } else {
      writeFileSync(UPDATE_STATE_FILE, JSON.stringify(newState, null, 2));
    }
  } catch {}
}

export function maybePrintUpdateNotice() {
  try {
    const view = readCacheView();
    if (!view || !view.state) return;
    let state = view.state;

    // 防御: legacy v2 顶层 schema 可能含其他 skill 的 outdated 条目，
    // 严格只透传 name===SKILL_NAME 的条目，杜绝跨 skill 通知泄露。
    // v3 path 走 skills[SKILL_NAME] 取节点本就不会含他人，这里主要保护 legacy 兼容路径。
    if (!view.isV3 && state.status === "update_available" && Array.isArray(state.outdated)) {
      const filtered = state.outdated.filter(o => o?.name === SKILL_NAME);
      if (filtered.length < state.outdated.length) {
        state = filtered.length === 0
          ? { ...state, status: "up_to_date", outdated: [] }
          : { ...state, outdated: filtered };
      }
    }

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
        if (view.state.snoozedUntil) state.snoozedUntil = view.state.snoozedUntil;
        if (typeof view.state.snoozeLevel === "number") {
          state.snoozeLevel = view.state.snoozeLevel;
        }
        writeCacheView(view, state);
      } else if (stillOutdated.length < state.outdated.length) {
        state = { ...state, outdated: stillOutdated };
        writeCacheView(view, state);
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
