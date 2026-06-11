#!/usr/bin/env node
import { once } from "node:events";
import { fileURLToPath } from "node:url";

// 稳定 CLI 入口：把参数转给 request.js（真正的请求 + SSE 解析在那边）。
// 必须 await 子进程退出，否则在某些 Windows / IDE 终端下父进程会先结束，
// 看到的只有 status/headers，后续流式正文被截断。
// 升级探针在 request.js 里接线（每次有效 --prompt 调用，对齐 wind-mcp-skill 的 call）。

const requestEntrypoint = new URL("./request.js", import.meta.url);

const args = process.argv.slice(2);

const isHelp = args.length === 0 || args.includes("--help") || args.includes("-h");
if (isHelp) {
  console.log(
    [
      "wind-alice — 调用万得 Alice Agent，执行指定 Skill 并流式输出分析结果",
      "",
      "Usage:",
      '  wind-alice --prompt <QUESTION> [--skill <SKILL_NAME>]',
      "  wind-alice list-skills",
      "  wind-alice --help",
      "",
      "Options:",
      "  --prompt, -p <QUESTION>     用户提问（必填，list-skills 除外）",
      "  --skill,  -s <SKILL_NAME>   Alice Skill 名，中英文均可：",
      '                                · 中文："上市公司调研问题清单"',
      '                                · 英文："Stock DD List"（忽略大小写/空白/-_ 模糊匹配）',
      "                              不传则走 auto",
      "  --list-skills               列出已知 Skill",
      "  --help,   -h                查看帮助",
      "",
      "Examples (PowerShell):",
      '  wind-alice --prompt "贵州茅台" --skill "上市公司调研问题清单"',
      '  wind-alice --prompt "贵州茅台" --skill "Stock DD List"',
      '  wind-alice -p "贵州茅台 600519" -s "公司一页纸"',
      "  wind-alice list-skills",
      "",
      "Config:",
      "  优先读取 %USERPROFILE%\\.wind-aifinmarket\\config (dotenv: WIND_API_KEY=...),",
      "  再读取 skill 目录 config.json (wind_api_key),",
      "  最后读取 WIND_API_KEY 环境变量",
    ].join("\n"),
  );
  process.exitCode = args.length === 0 ? 2 : 0;
} else {
  const nodePath = process.execPath;
  const { spawn } = await import("node:child_process");
  const child = spawn(
    nodePath,
    [fileURLToPath(requestEntrypoint), ...args],
    { stdio: "inherit" },
  );
  child.once("error", (err) => {
    console.error("spawn failed:", err.message);
    process.exitCode = 1;
  });
  const [code, signal] = await once(child, "exit");
  process.exitCode = signal ? 1 : (code ?? 1);
}
