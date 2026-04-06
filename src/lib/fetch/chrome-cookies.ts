import { execFile } from "node:child_process";
import { pbkdf2Sync, createDecipheriv } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir, homedir, platform } from "node:os";
import { join } from "node:path";

export type CookieMap = Record<string, string>;

interface BrowserConfig {
  name: string;
  baseDir: string;
  keychainService?: string;
  keychainAccount?: string;
}

const GOOGLE_ORIGINS = ["https://gemini.google.com", "https://accounts.google.com", "https://www.google.com"];
const REQUIRED_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC"];
const MACOS_BROWSER_CONFIGS: BrowserConfig[] = [
  { name: "Island", baseDir: "Library/Application Support/Island", keychainService: "Island Safe Storage", keychainAccount: "Island" },
  { name: "Chrome", baseDir: "Library/Application Support/Google/Chrome", keychainService: "Chrome Safe Storage", keychainAccount: "Chrome" },
  { name: "Arc", baseDir: "Library/Application Support/Arc/User Data", keychainService: "Arc Safe Storage", keychainAccount: "Arc" },
  { name: "Brave", baseDir: "Library/Application Support/BraveSoftware/Brave-Browser", keychainService: "Brave Safe Storage", keychainAccount: "Brave" }
];

function readKeychainPassword(account: string, service: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("security", ["find-generic-password", "-w", "-a", account, "-s", service], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.trim() || null);
    });
  });
}

let sqliteModule: typeof import("node:sqlite") | null = null;
async function importSqlite() {
  if (sqliteModule) return sqliteModule;
  sqliteModule = await import("node:sqlite");
  return sqliteModule;
}

function decryptCookieValue(encrypted: Uint8Array, key: Buffer): string | null {
  const buf = Buffer.from(encrypted);
  if (buf.length < 3 || !buf.subarray(0, 3).toString("utf8").match(/^v\d\d$/)) return null;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    decipher.setAutoPadding(false);
    const plaintext = Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()]);
    const padding = plaintext[plaintext.length - 1];
    return plaintext.subarray(0, plaintext.length - padding).toString("utf8").replace(/^\x00+/, "");
  } catch {
    return null;
  }
}

async function queryCookieRows(dbPath: string, hosts: string[]): Promise<Array<Record<string, unknown>> | null> {
  const sqlite = await importSqlite();
  const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const clauses: string[] = [];
    for (const host of hosts) {
      clauses.push(`host_key = '${host}'`);
      clauses.push(`host_key = '.${host}'`);
      clauses.push(`host_key LIKE '%.${host}'`);
    }
    return db.prepare(`SELECT name, value, host_key, encrypted_value FROM cookies WHERE ${clauses.join(" OR ")}`).all() as Array<Record<string, unknown>>;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function profileCandidates(baseDir: string): string[] {
  const prefs = ["Default"];
  try {
    const localState = JSON.parse(readFileSync(join(baseDir, "Local State"), "utf8")) as { profile?: { info_cache?: Record<string, unknown> } };
    for (const key of Object.keys(localState.profile?.info_cache ?? {})) if (!prefs.includes(key)) prefs.push(key);
  } catch {}
  return prefs;
}

export async function getGeminiCookies(): Promise<CookieMap | null> {
  if (platform() !== "darwin") return null;
  const hosts = GOOGLE_ORIGINS.map((origin) => new URL(origin).hostname);
  for (const config of MACOS_BROWSER_CONFIGS) {
    const browserDir = join(homedir(), config.baseDir);
    if (!existsSync(browserDir)) continue;
    const password = await readKeychainPassword(config.keychainAccount!, config.keychainService!);
    if (!password) continue;
    const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
    for (const profile of profileCandidates(browserDir)) {
      const cookiesPath = join(browserDir, profile, "Cookies");
      if (!existsSync(cookiesPath)) continue;
      const tempDir = mkdtempSync(join(tmpdir(), "search-gemini-cookies-"));
      try {
        const tempDb = join(tempDir, "Cookies");
        copyFileSync(cookiesPath, tempDb);
        const rows = await queryCookieRows(tempDb, hosts);
        if (!rows) continue;
        const cookies: CookieMap = {};
        for (const row of rows) {
          const name = String(row.name || "");
          if (!REQUIRED_COOKIES.includes(name) && name !== "NID" && name !== "AEC" && name !== "SOCS") continue;
          let value = typeof row.value === "string" && row.value ? row.value : null;
          if (!value && row.encrypted_value instanceof Uint8Array) value = decryptCookieValue(row.encrypted_value, key);
          if (value) cookies[name] = value;
        }
        if (REQUIRED_COOKIES.every((name) => cookies[name])) return cookies;
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }
  return null;
}
