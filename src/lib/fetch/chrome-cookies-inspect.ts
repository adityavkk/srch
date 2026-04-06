import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const MACOS_BROWSER_DIRS = [
  { name: "Island", path: "Library/Application Support/Island" },
  { name: "Chrome", path: "Library/Application Support/Google/Chrome" },
  { name: "Arc", path: "Library/Application Support/Arc/User Data" },
  { name: "Brave", path: "Library/Application Support/BraveSoftware/Brave-Browser" }
];

function profileCandidates(baseDir: string): string[] {
  const prefs = ["Default"];
  try {
    const localState = JSON.parse(readFileSync(join(baseDir, "Local State"), "utf8")) as { profile?: { info_cache?: Record<string, unknown> } };
    for (const key of Object.keys(localState.profile?.info_cache ?? {})) if (!prefs.includes(key)) prefs.push(key);
  } catch {}
  return prefs;
}

export function inspectGeminiCookieProfiles() {
  if (platform() !== "darwin") {
    return { supported: false, platform: platform(), browsers: [] };
  }
  const browsers = MACOS_BROWSER_DIRS.map((browser) => {
    const baseDir = join(homedir(), browser.path);
    const present = existsSync(baseDir);
    const profiles = present
      ? profileCandidates(baseDir).map((profile) => ({
          name: profile,
          cookiesDbPresent: existsSync(join(baseDir, profile, "Cookies"))
        }))
      : [];
    return {
      name: browser.name,
      present,
      profiles
    };
  });
  return { supported: true, platform: platform(), browsers };
}
