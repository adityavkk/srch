import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { activityMonitor } from "../core/activity.js";
import { errorMessage } from "../core/http.js";
import { checkGhAvailable } from "../fetch/github-api.js";

const execFileAsync = promisify(execFile);
const CLONE_ROOT = join(homedir(), ".search", "github-repos");

export interface RepoMatch {
  file: string;
  line: number;
  text: string;
}

export interface RepoSearchResult {
  target: string;
  query: string;
  localPath: string;
  cloned: boolean;
  cached: boolean;
  matches: RepoMatch[];
  matchCount: number;
  truncated: boolean;
  native: {
    provider: "ripgrep";
    args: string[];
  };
}

function parseGitHubRef(target: string): { owner: string; repo: string } | null {
  const urlMatch = target.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, "") };
  const slashMatch = target.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (slashMatch) return { owner: slashMatch[1], repo: slashMatch[2] };
  return null;
}

async function checkRgAvailable(): Promise<void> {
  try {
    await execFileAsync("rg", ["--version"], { timeout: 5_000 });
  } catch {
    throw new Error("ripgrep (rg) not found. Install it: brew install ripgrep");
  }
}

async function ensureClone(owner: string, repo: string): Promise<{ localPath: string; cached: boolean }> {
  const localPath = join(CLONE_ROOT, owner, repo);
  if (existsSync(join(localPath, ".git"))) {
    try {
      await execFileAsync("git", ["-C", localPath, "pull", "--ff-only", "--depth", "1"], { timeout: 15_000 });
    } catch (error) {
      // pull failed (detached head, network, etc.) -- use stale clone rather than fail
    }
    return { localPath, cached: true };
  }
  mkdirSync(join(CLONE_ROOT, owner), { recursive: true });
  try { rmSync(localPath, { recursive: true, force: true }); } catch {}
  const hasGh = await checkGhAvailable();
  const cloneArgs = hasGh
    ? ["gh", "repo", "clone", `${owner}/${repo}`, localPath, "--", "--depth", "1", "--single-branch"]
    : ["git", "clone", "--depth", "1", "--single-branch", `https://github.com/${owner}/${repo}.git`, localPath];
  try {
    await execFileAsync(cloneArgs[0], cloneArgs.slice(1), { timeout: 30_000 });
  } catch (error) {
    throw new Error(`Failed to clone ${owner}/${repo}: ${errorMessage(error)}`);
  }
  return { localPath, cached: false };
}

function resolveLocalPath(target: string): string {
  const resolved = resolve(target);
  if (!existsSync(resolved)) throw new Error(`Path does not exist: ${resolved}`);
  const stat = statSync(resolved);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${resolved}`);
  return resolved;
}

async function ripgrep(dir: string, query: string, maxResults = 30): Promise<{ matches: RepoMatch[]; truncated: boolean; args: string[] }> {
  const args = [
    "--json",
    "--max-count", "3",
    "--max-columns", "200",
    "--glob", "!.git",
    "--glob", "!node_modules",
    "--glob", "!vendor",
    "--glob", "!dist",
    "--glob", "!build",
    "--glob", "!*.min.*",
    "--glob", "!*.lock",
    "--glob", "!package-lock.json",
    "--smart-case",
    query,
    dir
  ];

  try {
    const { stdout } = await execFileAsync("rg", args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
    const matches: RepoMatch[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
        if (parsed.type === "match" && parsed.data) {
          const file = parsed.data.path?.text ?? "";
          const relative = file.startsWith(dir) ? file.slice(dir.length + 1) : file;
          matches.push({
            file: relative,
            line: parsed.data.line_number ?? 0,
            text: (parsed.data.lines?.text ?? "").trimEnd()
          });
        }
      } catch {
        // malformed JSON line from rg; skip
      }
      if (matches.length >= maxResults) break;
    }
    return { matches, truncated: matches.length >= maxResults, args };
  } catch (error: unknown) {
    const err = error as { code?: number };
    if (err.code === 1) return { matches: [], truncated: false, args }; // rg exit 1 = no matches
    throw new Error(`ripgrep failed: ${errorMessage(error)}`);
  }
}

export async function repoSearch(target: string, query: string): Promise<RepoSearchResult> {
  await checkRgAvailable();
  const ghRef = parseGitHubRef(target);
  let localPath: string;
  let cloned = false;
  let cached = false;

  if (ghRef) {
    const activityId = activityMonitor.logStart({ type: "fetch", url: `github.com/${ghRef.owner}/${ghRef.repo}` });
    try {
      const result = await ensureClone(ghRef.owner, ghRef.repo);
      localPath = result.localPath;
      cloned = true;
      cached = result.cached;
      activityMonitor.logComplete(activityId, 200);
    } catch (error) {
      activityMonitor.logError(activityId, errorMessage(error));
      throw error;
    }
  } else {
    localPath = resolveLocalPath(target);
  }

  const activityId = activityMonitor.logStart({ type: "api", query: `rg: ${query} in ${localPath}` });
  try {
    const { matches, truncated, args } = await ripgrep(localPath, query);
    activityMonitor.logComplete(activityId, 200);
    return {
      target,
      query,
      localPath,
      cloned,
      cached,
      matches,
      matchCount: matches.length,
      truncated,
      native: { provider: "ripgrep", args }
    };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}
