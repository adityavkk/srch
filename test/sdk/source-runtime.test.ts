import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "../../src/sdk/client.js";
import { coreModule } from "../../src/sdk/modules/core.js";
import { flightsModule } from "../../src/sdk/modules/flights.js";
import { codeSearch } from "../../src/lib/search/code.js";
import type { HttpClient, SecretResolver } from "../../src/sdk/types.js";

const text = "Documentation from the injected transport. ".repeat(4);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const mcp = (value: string) => json({ result: { content: [{ type: "text", text: value }] } });

test("non-web HTTP sources use only the client's injected dependencies", async () => {
  const calls: string[] = [];
  const secretNames: string[] = [];
  const http: HttpClient = { async fetch(input, init) {
    const url = String(input);
    calls.push(url);
    assert.ok(init?.signal);
    if (url.endsWith("/context")) {
      assert.equal(new Headers(init.headers).get("x-api-key"), "injected-exa-test-key");
      return json({ response: text });
    }
    if (url.includes("context7")) {
      const request = JSON.parse(String(init.body)) as { params: { name: string } };
      return mcp(request.params.name === "resolve-library-id" ? "/test/library" : text);
    }
    if (url.includes("deepwiki")) return mcp(text);
    assert.equal(new Headers(init.headers).get("Partner-Authorization"), "injected-seats-test-key");
    return json({ data: [{ id: "award", YRemainingSeats: 2 }] });
  } };
  const secrets: SecretResolver = { async resolve(name, signal) {
    assert.ok(signal);
    secretNames.push(name);
    return name === "exaApiKey" ? "injected-exa-test-key" : "injected-seats-test-key";
  } };
  const client = createClient({ config: { modules: [coreModule, flightsModule] }, http, secrets });
  assert.equal((await client.search("exa-code", { query: "test/library" }))[0]?.payload.text, text);
  assert.equal((await client.search("context7", { query: "test library" }))[0]?.payload.text, text);
  assert.equal((await client.search("deepwiki", { query: "test/library" }))[0]?.payload.text, text);
  assert.equal((await client.search("seats-aero", { query: "JFK CDG", originAirport: "JFK", destinationAirport: "CDG" })).length, 1);
  assert.equal(calls.length, 5);
  assert.deepEqual(secretNames, ["exaApiKey", "seatsAeroApiKey"]);
});

test("Exa code fallback uses injected HTTP and reports both failed transports", async () => {
  const calls: string[] = [];
  const client = createClient({ config: { modules: [coreModule, flightsModule] },
    secrets: { async resolve() { return "injected-test-key"; } },
    http: { async fetch(input) {
      calls.push(String(input));
      return json({}, 503);
    } }
  });
  await assert.rejects(client.search("exa-code", { query: "test" }), /Code search failed.*Exa Context.*503.*Exa MCP.*503/);
  assert.deepEqual(calls, ["https://api.exa.ai/context", "https://mcp.exa.ai/mcp"]);
});

test("Exa code genuine empty text stays empty", async () => {
  const client = createClient({ config: { modules: [coreModule, flightsModule] }, secrets: { async resolve() { return "injected-test-key"; } }, http: { async fetch() { return json({ response: "" }); } } });
  assert.deepEqual(await client.search("exa-code", { query: "unknown symbol" }), []);
});

test("code search can still return secondary evidence after both primary transports fail", async () => {
  const result = await codeSearch("test/library", 1000, undefined, {
    secrets: { async resolve() { return "injected-test-key"; } },
    http: { async fetch(input) {
      if (String(input).includes("deepwiki")) return mcp(text);
      return json({}, 503);
    } }
  });
  assert.match(result.text, /Documentation from the injected transport/);
  assert.equal(result.secondary?.[0]?.source, "deepwiki");
});

for (const name of ["context7", "deepwiki"] as const) {
  for (const response of [{ error: { message: "upstream unavailable" } }, { result: { isError: true, content: [{ type: "text", text: "upstream unavailable" }] } }]) {
    test(`${name} treats MCP errors as failures rather than empty results`, async () => {
      const client = createClient({ config: { modules: [coreModule, flightsModule] }, http: { async fetch() { return json(response); } } });
      await assert.rejects(client.search(name, { query: "test/library" }), /upstream unavailable/);
    });
  }
}

test("pre-aborted source requests do not resolve credentials, fetch, or spawn", async () => {
  const reason = new Error("cancelled before starting");
  const signal = AbortSignal.abort(reason);
  let calls = 0;
  const client = createClient({ config: { modules: [coreModule, flightsModule] },
    http: { async fetch() { calls++; throw new Error("unexpected HTTP"); } },
    secrets: { async resolve() { calls++; throw new Error("unexpected secret lookup"); } }
  });
  const requests = [
    client.search("exa-code", { query: "test", signal }),
    client.search("context7", { query: "test", signal }),
    client.search("deepwiki", { query: "no-repo", signal }),
    client.search("seats-aero", { query: "JFK CDG", originAirport: "JFK", destinationAirport: "CDG", signal }),
    client.search("fli", { query: "JFK CDG", origin: "JFK", destination: "CDG", dateFrom: "2026-12-01", signal })
  ];
  await Promise.all(requests.map((request) => assert.rejects(request, (error) => error === reason)));
  assert.equal(calls, 0);
});

for (const source of ["exa-code", "seats-aero"] as const) {
  test(`${source} cancellation during secret lookup stops before HTTP or fallback`, async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled during lookup");
    let calls = 0;
    const client = createClient({ config: { modules: [coreModule, flightsModule] },
      secrets: { async resolve(_name, signal) {
        assert.ok(signal);
        controller.abort(reason);
        return "late-test-key";
      } },
      http: { async fetch() { calls++; return json({}); } }
    });
    const request = source === "exa-code"
      ? client.search(source, { query: "test", signal: controller.signal })
      : client.search(source, { query: "JFK CDG", originAirport: "JFK", destinationAirport: "CDG", signal: controller.signal });
    await assert.rejects(request, (error) => error === reason);
    assert.equal(calls, 0);
  });
}

test("Context7 cancellation after resolution prevents the document request", async () => {
  const controller = new AbortController();
  const reason = new Error("stop after resolution");
  let calls = 0;
  const client = createClient({ config: { modules: [coreModule, flightsModule] }, http: { async fetch() {
    calls++;
    controller.abort(reason);
    return mcp("/test/library");
  } } });
  await assert.rejects(client.search("context7", { query: "test", signal: controller.signal }), (error) => error === reason);
  assert.equal(calls, 1);
});

for (const source of ["exa-code", "context7", "deepwiki", "seats-aero"] as const) {
  test(`${source} passes cancellation through an active HTTP request`, async () => {
    const controller = new AbortController();
    const reason = new Error("stop active request");
    let calls = 0;
    const client = createClient({ config: { modules: [coreModule, flightsModule] },
      secrets: { async resolve() { return "injected-test-key"; } },
      http: { fetch(_input, init) {
        calls++;
        assert.ok(init?.signal);
        const signal = init.signal;
        const response = new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
        controller.abort(reason);
        return response;
      } }
    });
    const request = source === "seats-aero"
      ? client.search(source, { query: "JFK CDG", originAirport: "JFK", destinationAirport: "CDG", signal: controller.signal })
      : client.search(source, { query: "test/library", signal: controller.signal });
    await assert.rejects(request, (error) => error === reason);
    assert.equal(calls, 1);
  });
}
