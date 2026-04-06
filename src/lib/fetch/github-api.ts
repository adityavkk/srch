import { execFile } from "node:child_process";
import type { ExtractedContent } from "../core/types.js";
import type { GitHubUrlInfo } from "./github.ts";

const MAX_TREE_ENTRIES = 200;
const MAX_INLINE_FILE_CHARS = 100_000;

let ghAvailable: boolean | null = null;

export async function checkGhAvailable(): Promise<boolean> {
  if (ghAvailable !== null) return ghAvailable;
  return new Promise((resolve) => {
    execFile("gh", ["--version"], { timeout: 5000 }, (err) => {
      ghAvailable = !err;
      resolve(ghAvailable);
    });
  });
}

export async function checkRepoSize(owner: string, repo: string): Promise<number | null> {
  if (!(await checkGhAvailable())) return null;
  return new Promise((resolve) => {
    execFile("gh", ["api", `repos/${owner}/${repo}`, "--jq", ".size"], { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve(null);
      const kb = parseInt(stdout.trim(), 10);
      resolve(Number.isNaN(kb) ? null : kb);
    });
  });
}

async function getDefaultBranch(owner: string, repo: string): Promise<string | null> {
  if (!(await checkGhAvailable())) return null;
  return new Promise((resolve) => {
    execFile("gh", ["api", `repos/${owner}/${repo}`, "--jq", ".default_branch"], { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.trim() || null);
    });
  });
}

async function fetchTreeViaApi(owner: string, repo: string, ref: string): Promise<string | null> {
  if (!(await checkGhAvailable())) return null;
  return new Promise((resolve) => {
    execFile("gh", ["api", `repos/${owner}/${repo}/git/trees/${ref}?recursive=1`, "--jq", ".tree[].path"], { timeout: 15000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      const paths = stdout.trim().split("\n").filter(Boolean);
      if (paths.length === 0) return resolve(null);
      const truncated = paths.length > MAX_TREE_ENTRIES;
      const display = paths.slice(0, MAX_TREE_ENTRIES).join("\n");
      resolve(truncated ? display + `\n... (${paths.length} total entries)` : display);
    });
  });
}

async function fetchReadmeViaApi(owner: string, repo: string, ref: string): Promise<string | null> {
  if (!(await checkGhAvailable())) return null;
  return new Promise((resolve) => {
    execFile("gh", ["api", `repos/${owner}/${repo}/readme?ref=${ref}`, "--jq", ".content"], { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const decoded = Buffer.from(stdout.trim(), "base64").toString("utf-8");
        resolve(decoded.length > 8192 ? decoded.slice(0, 8192) + "\n\n[README truncated at 8K chars]" : decoded);
      } catch {
        resolve(null);
      }
    });
  });
}

async function fetchFileViaApi(owner: string, repo: string, path: string, ref: string): Promise<string | null> {
  if (!(await checkGhAvailable())) return null;
  return new Promise((resolve) => {
    execFile("gh", ["api", `repos/${owner}/${repo}/contents/${path}?ref=${ref}`, "--jq", ".content"], { timeout: 10000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(Buffer.from(stdout.trim(), "base64").toString("utf-8"));
      } catch {
        resolve(null);
      }
    });
  });
}

export async function fetchViaApi(url: string, owner: string, repo: string, info: GitHubUrlInfo): Promise<ExtractedContent | null> {
  const ref = info.ref || (await getDefaultBranch(owner, repo));
  if (!ref) return null;
  const lines: string[] = [];
  if (info.type === "blob" && info.path) {
    const content = await fetchFileViaApi(owner, repo, info.path, ref);
    if (!content) return null;
    lines.push(`## ${info.path}`);
    lines.push(content.length > MAX_INLINE_FILE_CHARS ? content.slice(0, MAX_INLINE_FILE_CHARS) + "\n[File truncated at 100K chars]" : content);
    return { url, title: `${owner}/${repo} - ${info.path}`, content: lines.join("\n"), error: null };
  }
  const [tree, readme] = await Promise.all([fetchTreeViaApi(owner, repo, ref), fetchReadmeViaApi(owner, repo, ref)]);
  if (!tree && !readme) return null;
  if (tree) {
    lines.push("## Structure");
    lines.push(tree);
    lines.push("");
  }
  if (readme) {
    lines.push("## README.md");
    lines.push(readme);
  }
  return { url, title: `${owner}/${repo}`, content: lines.join("\n"), error: null };
}
