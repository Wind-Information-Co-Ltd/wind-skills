/**
 * 把 agentResult.value 正文中的 `/project/xxx` 附件引用，
 * 就地替换为统一的本地文件 Markdown 链接，供 stdout 交付使用。
 *
 * 统一展示格式：[文件名](file:///D:/path/to/文件名)
 *
 * @param {string} text  agentResult.value 原文
 * @param {string} downloadDir  本地下载目录绝对路径
 * @returns {string}
 */
export function sanitizeAgentResultTextForDelivery(text, downloadDir = "") {
  if (!text || typeof text !== "string") return text;

  // 1) 去掉 "### ...完整报告" 这类标题行（仍保留）
  let out = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^#{1,6}\s+.*完整报告/.test(line.trim())) continue;
    out.push(line);
  }
  let body = out.join("\n");

  // 2) 收集所有 /project/xxx 引用并替换
  if (!downloadDir) return body.replace(/\n{3,}/g, "\n\n").trimEnd();

  const refs = collectProjectRefs(body);
  for (const { relPath, filename } of refs) {
    const localPath = joinPath(downloadDir, filename);
    body = replaceProjectRef(body, relPath, filename, localPath);
  }

  return body.replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * 把本地绝对路径转为 file:/// URL（正斜杠）。
 * 例：D:\foo\bar.md -> file:///D:/foo/bar.md
 */
export function toFileUrl(localPath) {
  const normalized = String(localPath).replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(normalized)) {
    return "file:///" + normalized;
  }
  return "file://" + normalized;
}

/**
 * 统一的本地文件展示格式：[文件名](file:///...) (D:\下载目录\文件名)
 */
export function formatLocalFileLink(localPath) {
  const filename = basename(localPath);
  return `[${filename}](${toFileUrl(localPath)}) (${localPath})`;
}

/**
 * 收集正文中所有 /project/xxx.ext 引用，返回 [{relPath, filename}]，去重。
 */
function collectProjectRefs(text) {
  const found = new Map();
  const extRe = /\.(md|markdown|xlsx|xls|csv|pdf|docx|doc|pptx|ppt|txt|zip|rar|7z|png|jpg|jpeg|svg|html|htm|json)$/i;

  // Markdown 链接 [name](/project/xxx)
  const mdRelRe = /\[([^\]]+)\]\((\/project\/[^)\s]+)\)/g;
  let m;
  while ((m = mdRelRe.exec(text)) !== null) {
    const relPath = m[2];
    const filename = relPath.split("/").pop();
    if (!extRe.test(filename)) continue;
    if (!found.has(relPath)) found.set(relPath, filename);
  }

  // file:///project/xxx
  const fileSchemeMdRe = /\[([^\]]+)\]\(file:\/\/\/?(\/project\/[^)\s]+)\)/gi;
  while ((m = fileSchemeMdRe.exec(text)) !== null) {
    const relPath = m[2];
    const filename = relPath.split("/").pop();
    if (!extRe.test(filename)) continue;
    if (!found.has(relPath)) found.set(relPath, filename);
  }

  // 裸文本 file:///project/xxx.ext
  const fileSchemeBareRe = /(?<![/\w-])file:\/\/\/?(\/project\/[^\s`<>"'，。、：；\]\[(]+\.[A-Za-z0-9]+)/gi;
  while ((m = fileSchemeBareRe.exec(text)) !== null) {
    const relPath = m[1];
    const filename = relPath.split("/").pop();
    if (!extRe.test(filename)) continue;
    if (!found.has(relPath)) found.set(relPath, filename);
  }

  // 反引号 / 裸文本中的 /project/xxx.ext
  const bareRelRe = /(?<![/\w-])\/project\/[^\s`<>"'，。、：；\]\[(]+\.[A-Za-z0-9]+/g;
  while ((m = bareRelRe.exec(text)) !== null) {
    const relPath = m[0];
    const filename = relPath.split("/").pop();
    if (!extRe.test(filename)) continue;
    if (!found.has(relPath)) found.set(relPath, filename);
  }

  return Array.from(found, ([relPath, filename]) => ({ relPath, filename }));
}

/**
 * 把正文中匹配到的 /project/xxx 引用替换为 [filename](file:///...)。
 */
function replaceProjectRef(text, relPath, filename, localPath) {
  const link = formatLocalFileLink(localPath);

  // Markdown 相对链接 [任意名称](/project/xxx) -> 统一格式
  const mdRelRe = new RegExp(
    "\\[([^\\]]+)\\]\\(" + escapeRegex(relPath) + "\\)",
    "g",
  );
  text = text.replace(mdRelRe, () => link);

  // file:///project/xxx 形式
  const fileSchemePatterns = [
    new RegExp("\\[([^\\]]+)\\]\\(file://+/?" + escapeRegex(relPath) + "\\)", "gi"),
    new RegExp("(?<![/\\w-])file://+/?" + escapeRegex(relPath), "gi"),
  ];
  for (const re of fileSchemePatterns) {
    text = text.replace(re, () => link);
  }

  // 反引号包裹：`` `/project/xxx` ``
  const backtickRe = new RegExp("`" + escapeRegex(relPath) + "`", "g");
  text = text.replace(backtickRe, link);

  // 裸文本 /project/xxx
  const bareRe = new RegExp("(?<![/\\w-])" + escapeRegex(relPath), "g");
  text = text.replace(bareRe, link);

  return text;
}

function basename(localPath) {
  const parts = String(localPath).split(/[/\\]/);
  return parts[parts.length - 1] || String(localPath);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function joinPath(dir, filename) {
  if (!dir) return filename;
  const sep = dir.includes("\\") ? "\\" : "/";
  const trimmed = dir.replace(/[\\/]+$/, "");
  return trimmed + sep + filename;
}
