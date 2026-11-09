export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export class ResponseTooLargeError extends Error {
  constructor(maxBytes = MAX_DOCUMENT_BYTES) {
    super(`Response too large: limit is ${maxBytes} bytes`);
    this.name = "ResponseTooLargeError";
  }
}

/** Bound the decoded stream as well as Content-Length, which may be absent or compressed. */
export async function readResponseBytes(response: Response, signal?: AbortSignal, maxBytes = MAX_DOCUMENT_BYTES): Promise<Uint8Array<ArrayBuffer>> {
  signal?.throwIfAborted();
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new ResponseTooLargeError(maxBytes);
  }
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new ResponseTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

export async function readResponseText(response: Response, signal?: AbortSignal): Promise<string> {
  return new TextDecoder().decode(await readResponseBytes(response, signal));
}
