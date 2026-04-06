import { TwitterClient, resolveCredentials } from "@steipete/bird";
import { activityMonitor } from "../core/activity.js";
import { errorMessage } from "../core/http.js";

export interface Tweet {
  id: string;
  text: string;
  author: string;
  createdAt?: string;
}

export interface TwitterSearchResult {
  query: string;
  count: number;
  tweets: Tweet[];
  native: unknown;
}

export interface TwitterReadResult {
  id: string;
  tweet: unknown;
  native: unknown;
}

export interface TwitterThreadResult {
  id: string;
  tweets: unknown[];
  native: unknown;
}

function normalizeTweet(raw: Record<string, unknown>): Tweet {
  return {
    id: String(raw.id ?? ""),
    text: String(raw.text ?? raw.full_text ?? ""),
    author: String(raw.username ?? raw.screen_name ?? raw.author ?? ""),
    createdAt: raw.created_at ? String(raw.created_at) : undefined
  };
}

let cachedClient: TwitterClient | null = null;

async function getClient(): Promise<TwitterClient> {
  if (cachedClient) return cachedClient;
  const creds = await resolveCredentials({});
  if (!creds.cookies.authToken || !creds.cookies.ct0) {
    throw new Error("Twitter auth not available. Log into x.com in Safari/Chrome or set AUTH_TOKEN + CT0 env vars.");
  }
  cachedClient = new TwitterClient({ cookies: creds.cookies });
  return cachedClient;
}

export async function twitterSearch(query: string, count = 10): Promise<TwitterSearchResult> {
  const activityId = activityMonitor.logStart({ type: "api", query: `twitter: ${query}` });
  try {
    const client = await getClient();
    const raw = await client.search(query, count);
    const tweets = Array.isArray(raw) ? raw.map((item: Record<string, unknown>) => normalizeTweet(item)) : [];
    activityMonitor.logComplete(activityId, 200);
    return { query, count: tweets.length, tweets, native: raw };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}

export async function twitterRead(idOrUrl: string): Promise<TwitterReadResult> {
  const activityId = activityMonitor.logStart({ type: "api", query: `twitter-read: ${idOrUrl}` });
  try {
    const client = await getClient();
    const tweetId = extractTweetId(idOrUrl);
    const raw = await client.getTweet(tweetId);
    activityMonitor.logComplete(activityId, 200);
    return { id: tweetId, tweet: raw, native: raw };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}

export async function twitterThread(idOrUrl: string): Promise<TwitterThreadResult> {
  const activityId = activityMonitor.logStart({ type: "api", query: `twitter-thread: ${idOrUrl}` });
  try {
    const client = await getClient();
    const tweetId = extractTweetId(idOrUrl);
    const raw = await client.getThread(tweetId);
    const tweets = Array.isArray(raw) ? raw : [];
    activityMonitor.logComplete(activityId, 200);
    return { id: tweetId, tweets, native: raw };
  } catch (error) {
    activityMonitor.logError(activityId, errorMessage(error));
    throw error;
  }
}

function extractTweetId(idOrUrl: string): string {
  const match = idOrUrl.match(/status\/(\d+)/);
  return match?.[1] ?? idOrUrl;
}
