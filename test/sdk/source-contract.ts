import assert from "node:assert/strict";
import { createTraceSink } from "../../src/lib/trace.js";
import type {
  AnySource,
  Evidence,
  NonEmptyArray,
  Provenance,
  RunResult,
  SecretResolver,
  Source,
  SourceContext,
  SourceRequest
} from "../../src/sdk/types.js";

/**
 * Reusable source-contract assertions, shared by every per-source test.
 *
 * Sources reach their transports through different seams (an injected
 * `globalThis.fetch`, a dynamically imported lib backend, a seeded local
 * index), so the helpers below take the already-prepared source plus a request
 * and assert the parts of the contract that every source must honour:
 *
 *  - success runs return `Evidence` whose envelope and provenance are fully
 *    populated (see {@link assertEvidenceContract});
 *  - a transport/network failure surfaces as a typed `RunError`/`RunEmpty`
 *    with suggestions and never throws out of the source boundary
 *    (see {@link assertTypedFailure});
 *  - the source advertises the capabilities and transports it actually uses
 *    (see {@link assertCapabilities}).
 */

type SecretMap = Record<string, string | null>;

/** Build a faithful {@link SourceContext} for calling `source.run` directly. */
export function makeSourceContext(
  options: { secrets?: SecretMap; trace?: boolean } = {}
): SourceContext {
  const secretMap = options.secrets ?? {};
  const secrets: SecretResolver = {
    resolve(name) {
      return Promise.resolve(name in secretMap ? secretMap[name] : null);
    }
  };

  return {
    secrets,
    trace: createTraceSink(options.trace ?? false),
    http: { fetch: globalThis.fetch.bind(globalThis) }
  };
}

function assertProvenance(provenance: Provenance, query: string): void {
  assert.ok(provenance, `evidence for "${query}" is missing provenance`);
  assert.equal(typeof provenance.timestamp, "number", "provenance.timestamp must be a number");
  assert.ok(Number.isFinite(provenance.timestamp), "provenance.timestamp must be finite");

  switch (provenance.kind) {
    case "web":
      assert.ok(provenance.url.length > 0, "web provenance must carry a url");
      assert.ok(provenance.transport.length > 0, "web provenance must carry a transport");
      assert.equal(typeof provenance.cached, "boolean", "web provenance must carry cached");
      break;
    case "api":
      assert.ok(provenance.api.length > 0, "api provenance must carry an api name");
      assert.ok(provenance.transport.length > 0, "api provenance must carry a transport");
      assert.equal(typeof provenance.cached, "boolean", "api provenance must carry cached");
      break;
    case "local":
      assert.ok(provenance.path.length > 0, "local provenance must carry a path");
      break;
    case "clone":
      assert.ok(provenance.repo.length > 0, "clone provenance must carry a repo");
      assert.ok(provenance.localPath.length > 0, "clone provenance must carry a localPath");
      assert.equal(typeof provenance.cached, "boolean", "clone provenance must carry cached");
      break;
    default: {
      const exhaustive: never = provenance;
      throw new Error(`unknown provenance kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Assert that every item in an evidence array honours the envelope contract:
 * the expected `source`/`domain`, a `query` echoed back from the request, and a
 * fully-populated `provenance` for its kind.
 */
export function assertEvidenceContract(
  evidence: Evidence[],
  expected: { source: string; domain: string; query: string }
): void {
  for (const item of evidence) {
    assert.equal(item.source, expected.source, "evidence.source must match the source name");
    assert.equal(item.domain, expected.domain, "evidence.domain must match the source domain");
    assert.equal(item.query, expected.query, "evidence.query must echo the request query");
    assert.ok(item.payload !== undefined && item.payload !== null, "evidence.payload must be set");
    assertProvenance(item.provenance, expected.query);
  }
}

/**
 * Run a source directly with mocked transports and assert it returns non-empty,
 * contract-conforming evidence. Returns the evidence so callers can make
 * source-specific payload assertions on top of the shared contract.
 */
export async function assertSuccessContract<
  TRequest extends SourceRequest,
  TPayload
>(
  source: Source<TRequest, TPayload>,
  request: TRequest,
  context: SourceContext = makeSourceContext()
): Promise<Evidence<TPayload>[]> {
  const evidence = await source.run(request, context);
  assert.ok(evidence.length > 0, `${source.name} should yield evidence for a successful run`);
  assertEvidenceContract(evidence, {
    source: source.name,
    domain: source.domain,
    query: request.query
  });
  return evidence;
}

type FailureResult = Extract<RunResult, { kind: "error" | "empty" }>;

/**
 * Drive a source through a strategy (via `client.run`) along a transport-failure
 * path and assert it degrades to a typed `RunError`/`RunEmpty` with suggestions,
 * without letting an exception escape the source boundary.
 */
export async function assertTypedFailure(
  run: () => Promise<RunResult>,
  expected: { kind: "error" | "empty"; domain: string }
): Promise<FailureResult> {
  let result: RunResult;
  try {
    result = await run();
  } catch (error) {
    assert.fail(
      `source failure must not throw out of the source boundary, but threw: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  assert.equal(result.kind, expected.kind, `expected a typed ${expected.kind} result`);
  assert.equal(result.domain, expected.domain, "failure result must carry its domain");

  if (result.kind === "error") {
    assert.ok(result.error.message.length > 0, "RunError must carry a message");
    assert.ok(result.error.code.length > 0, "RunError must carry a code");
  }

  assertSuggestions(result.suggestions);
  return result;
}

function assertSuggestions(suggestions: NonEmptyArray<string>): void {
  assert.ok(Array.isArray(suggestions), "typed failures must carry suggestions");
  assert.ok(suggestions.length > 0, "typed failures must carry at least one suggestion");
  for (const suggestion of suggestions) {
    assert.ok(suggestion.length > 0, "each suggestion must be a non-empty string");
  }
}

/**
 * Assert that a source advertises the capabilities and transports it relies on.
 * Capability and transport lists are non-empty by type, so this verifies the
 * declared identity and that every claimed capability/transport is present.
 */
export function assertCapabilities(
  source: AnySource,
  expected: { name: string; domain: string; capabilities: string[]; transports: string[] }
): void {
  assert.equal(source.name, expected.name, "source name mismatch");
  assert.equal(source.domain, expected.domain, "source domain mismatch");
  assert.ok(source.capabilities.length > 0, "source must declare at least one capability");
  assert.ok(source.transports.length > 0, "source must declare at least one transport");

  for (const capability of expected.capabilities) {
    assert.ok(
      source.capabilities.includes(capability),
      `source ${source.name} must declare capability "${capability}"`
    );
  }
  for (const transport of expected.transports) {
    assert.ok(
      source.transports.includes(transport),
      `source ${source.name} must declare transport "${transport}"`
    );
  }
}
