import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { extname, join, resolve as resolvePath, sep as pathSep } from "node:path";
import { activityMonitor } from "../core/activity.js";
import type { ExtractedContent } from "../core/types.js";
import { checkGhAvailable, checkRepoSize, fetchViaApi } from "./github-api.js";

const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp3", ".mp4", ".zip", ".gz", ".pdf", ".sqlite", ".db"]);
const NOISE_DIRS = new Set(["node_modules", "vendor", ".next", "dist", "build", "__pycache__", ".venv", "target", ".git"]);
const MAX_INLINE_FILE_CHARS = 100_000;
const MAX_TREE_ENTRIES = 200;
const CLONE_ROOT = join(homedir(), ".search", "github-repos");
const MAX_REPO_MB = 350;

export interface GitHubUrlInfo {
  owner: string;
  repo: string;
  ref?: string;
  refIsFullSha: boolean;
  path?: string;
  type: "root" | "blob" | "tree";
}

export function parseGitHubUrl(url: string): GitHubUrlInfo | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;
  const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  if (segments.length < 2) return null;
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, "");
  if (segments.length === 2) return { owner, repo, refIsFullSha: false, type: "root" };
  const action = segments[2];
  if (action !== "blob" && action !== "tree") return null;
  if (segments.length < 4) return null;
  const ref = segments[3];
  const refIsFullSha = /^[0-9a-f]{40}$/.test(ref);
  const path = segments.slice(4).join("/");
  return { owner, repo, ref, refIsFullSha, path, type: action as "blob" | "tree" };
}

function cloneDir(owner: string, repo: string, ref?: string): string {
  return join(CLONE_ROOT, owner, ref ? `${repo}@${ref}` : repo);
}

function resolveWithinRepo(rootPath: string, relativePath: string): string | null {
  const normalizedRoot = resolvePath(rootPath);
  const candidate = resolvePath(normalizedRoot, relativePath);
  if (candidate !== normalizedRoot) {
    const rootPrefix = normalizedRoot.endsWith(pathSep) ? normalizedRoot : normalizedRoot + pathSep;
    if (!candidate.startsWith(rootPrefix)) return null;
  }
  return candidate;
}

function isBinaryFile(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function buildTree(rootPath: string): string {
  const entries: string[] = [];
  function walk(dir: string, relPath: string): void {
    if (entries.length >= MAX_TREE_ENTRIES) return;
    let items: string[];
    try { items = readdirSync(dir).sort(); } catch { return; }
    for (const item of items) {
      if (entries.length >= MAX_TREE_ENTRIES) return;
      if (NOISE_DIRS.has(item)) continue;
      const rel = relPath ? `${relPath}/${item}` : item;
      const safePath = resolveWithinRepo(rootPath, rel);
      if (!safePath) continue;
      const stat = statSync(safePath);
      if (stat.isDirectory()) {
        entries.push(`${rel}/`);
        walk(safePath, rel);
      } else {
        entries.push(rel);
      }
    }
  }
  walk(rootPath, "");
  if (entries.length >= MAX_TREE_ENTRIES) entries.push(`... (truncated at ${MAX_TREE_ENTRIES} entries)`);
  return entries.join("\n");
}

function readReadme(localPath: string): string | null {
  for (const name of ["README.md", "readme.md", "README", "README.txt", "README.rst"]) {
    const readmePath = join(localPath, name);
    if (!existsSync(readmePath)) continue;
    try {
      const content = readFileSync(readmePath, "utf-8");
      return content.length > 8192 ? content.slice(0, 8192) + "\n\n[README truncated at 8K chars]" : content;
    } catch {
    }
  }
  return null;
}

function buildDirListing(rootPath: string, subPath: string): string {
  const targetPath = resolveWithinRepo(rootPath, subPath);
  if (!targetPath || !existsSync(targetPath)) return "(directory not readable)";
  const items = readdirSync(targetPath).sort();
  return items.filter((item) => !NOISE_DIRS.has(item)).map((item) => {
    const stat = statSync(join(targetPath, item));
    return stat.isDirectory() ? `  ${item}/` : `  ${item}`;
  }).join("\n");
}

function generateContent(localPath: string, info: GitHubUrlInfo): string {
  const lines: string[] = [`Repository cloned to: ${localPath}`, ""];
  if (info.type === "root") {
    lines.push("## Structure", buildTree(localPath), "");
    const readme = readReadme(localPath);
    if (readme) lines.push("## README.md", readme, "");
    lines.push("Use read/bash on the local path for deeper exploration.");
    return lines.join("\n");
  }
  if (info.type === "tree") {
    lines.push(`## ${info.path || "/"}`, buildDirListing(localPath, info.path || ""), "", "Use read/bash on the local path for deeper exploration.");
    return lines.join("\n");
  }
  const filePath = resolveWithinRepo(localPath, info.path || "");
  if (!filePath || !existsSync(filePath)) return `Path not found.\n\n${buildTree(localPath)}`;
  if (isBinaryFile(filePath)) return `Binary file: ${info.path}`;
  const content = readFileSync(filePath, "utf-8");
  lines.push(`## ${info.path}`);
  lines.push(content.length > MAX_INLINE_FILE_CHARS ? content.slice(0, MAX_INLINE_FILE_CHARS) + "\n\n[File truncated at 100K chars]" : content);
  lines.push("", "Use read/bash on the local path for deeper exploration.");
  return lines.join("\n");
}

function execClone(args: string[], localPath: string, timeoutMs: number, signal?: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(args[0], args.slice(1), { timeout: timeoutMs }, (err) => {
      if (err) {
        try { rmSync(localPath, { recursive: true, force: true }); } catch {}
        return resolve(null);
      }
      resolve(localPath);
    });
    if (signal) signal.addEventListener("abort", () => child.kill(), { once: true });
  });
}

async function cloneRepo(owner: string, repo: string, ref: string | undefined, signal?: AbortSignal): Promise<string | null> {
  const localPath = cloneDir(owner, repo, ref);
  mkdirSync(join(CLONE_ROOT, owner), { recursive: true });
  try { rmSync(localPath, { recursive: true, force: true }); } catch {}
  const hasGh = await checkGhAvailable();
  const timeoutMs = 30_000;
  if (hasGh) {
    const args = ["gh", "repo", "clone", `${owner}/${repo}`, localPath, "--", "--depth", "1", "--single-branch"];
    if (ref) args.push("--branch", ref);
    return execClone(args, localPath, timeoutMs, signal);
  }
  const args = ["git", "clone", "--depth", "1", "--single-branch"];
  if (ref) args.push("--branch", ref);
  args.push(`https://github.com/${owner}/${repo}.git`, localPath);
  return execClone(args, localPath, timeoutMs, signal);
}

export async function extractGitHub(url: string, signal?: AbortSignal): Promise<ExtractedContent | null> {
  const info = parseGitHubUrl(url);
  if (!info) return null;
  const { owner, repo } = info;
  const activityId = activityMonitor.logStart({ type: "fetch", url: `github.com/${owner}/${repo}` });

  if (info.refIsFullSha) {
    const apiView = await fetchViaApi(url, owner, repo, info);
    activityMonitor.logComplete(activityId, apiView ? 200 : 0);
    return apiView;
  }

  const sizeKB = await checkRepoSize(owner, repo);
  if (sizeKB !== null && sizeKB / 1024 > MAX_REPO_MB) {
    const apiView = await fetchViaApi(url, owner, repo, info);
    activityMonitor.logComplete(activityId, apiView ? 200 : 0);
    return apiView;
  }

  const cloned = await cloneRepo(owner, repo, info.ref, signal);
  if (!cloned) {
    const apiView = await fetchViaApi(url, owner, repo, info);
    activityMonitor.logComplete(activityId, apiView ? 200 : 0);
    return apiView;
  }

  activityMonitor.logComplete(activityId, 200);
  return {
    url,
    title: info.path ? `${owner}/${repo} - ${info.path}` : `${owner}/${repo}`,
    content: generateContent(cloned, info),
    error: null
  };
}
