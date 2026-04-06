import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createStore, type QMDStore } from "@tobilu/qmd";

const DB_PATH = join(homedir(), ".search", "qmd", "index.sqlite");

async function withStore<T>(fn: (store: QMDStore) => Promise<T>): Promise<T> {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const store = await createStore({ dbPath: DB_PATH });
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

export function getDocsDbPath(): string {
  return DB_PATH;
}

export async function docsSearch(query: string, limit = 8) {
  return withStore(async (store) => {
    const raw = await store.search({
      queries: [{ type: "lex", query }],
      rerank: false,
      limit
    });
    return {
      query,
      limit,
      backend: "qmd-sdk" as const,
      mode: "lex" as const,
      raw,
      results: raw.map((item) => ({
        title: item.title,
        file: item.file,
        score: item.score,
        docid: item.docid,
        bestChunk: item.bestChunk
      }))
    };
  });
}

export async function docsAddCollection(path: string, name: string, pattern = "**/*.md") {
  return withStore(async (store) => {
    await store.addCollection(name, { path: resolve(path), pattern });
    return store.listCollections();
  });
}

export async function docsListCollections() {
  return withStore(async (store) => store.listCollections());
}

export async function docsUpdate() {
  return withStore(async (store) => store.update());
}

export async function docsEmbed() {
  return withStore(async (store) => store.embed());
}

export async function docsStatus() {
  return withStore(async (store) => {
    const [status, health, collections] = await Promise.all([
      store.getStatus(),
      store.getIndexHealth(),
      store.listCollections()
    ]);
    return { status, health, collections, dbPath: DB_PATH, backend: "qmd-sdk" as const };
  });
}
