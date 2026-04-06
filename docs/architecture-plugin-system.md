# plugin system examples

This file complements `architecture.md` with concrete examples.

## Example: free-first web strategy

```json
{
  "name": "web-default",
  "steps": [
    { "source": "exa-mcp", "query": "{query}", "mode": "primary" },
    { "source": "brave", "query": "{query}", "mode": "fallback" },
    { "source": "gemini-web", "query": "{query}", "mode": "fallback" },
    { "source": "gemini-api", "query": "{query}", "mode": "fallback" },
    { "source": "perplexity", "query": "{query}", "mode": "fallback" }
  ]
}
```

## Example: code strategy with always-on secondary context

```json
{
  "name": "code-default",
  "steps": [
    { "source": "exa-context", "query": "{query}", "mode": "primary" },
    { "source": "context7", "query": "{query}", "mode": "secondary" },
    { "source": "deepwiki", "query": "{query}", "mode": "secondary", "when": "repoRefPresent" }
  ],
  "combine": { "appendSecondary": true }
}
```

## Example: repo deep search strategy

```json
{
  "name": "repo-deep-search",
  "steps": [
    { "source": "github-clone", "target": "{target}" },
    { "source": "repo-local-search", "target": "{prepared.localPath}", "query": "{query}" }
  ]
}
```

## Example: agentic ask mode

```bash
search ask "Compare Bun vs Node for CLI tooling and cite sources"
```

Possible plan:
1. run `web-default`
2. fetch top 5 URLs
3. cross-check one claim via secondary source
4. synthesize answer

## Example: plugin package shape

```ts
export const sources = [redditSource, hnSource];
export const strategies = [trendStrategy];
```

## Example: user value by layer

- source layer: direct, cheap, predictable
- strategy layer: less manual orchestration
- agent layer: better handling of vague or complex subproblems
