# Security notes — @urbankitstudio/mcp-atlas

Known advisories in this package's dependency tree, why they are where they are,
and what was decided. Written down so an audit does not have to re-derive it and
does not re-raise a closed question.

Last reviewed: **2026-08-05**, against `@modelcontextprotocol/sdk@1.30.0`.

## Two HIGH advisories, both upstream and both unreachable here

`npm audit` reports four advisories, two of them HIGH. Both come from the MCP
SDK's own dependency tree, not from anything this package requires directly:

| Advisory | Path | Reachable from this server? |
|---|---|---|
| `fast-uri` host confusion (GHSA-v2hh-gcrm-f6hx, -7p8r-x3mc-p8w7, -4c8g-83qw-93j6) | `sdk → ajv → fast-uri` | Loaded, but **no attack surface** — see below |
| `ip-address` SSRF / trust bypass (GHSA-mwp4-54f8-5fhr, -4xrf-jv44-h6hh, -22jq-vg5j-6vgg) | `sdk → express-rate-limit → ip-address` | **No** — never loaded |

### Why `ip-address` is not loaded

`express-rate-limit` is imported only by the SDK's OAuth handlers
(`dist/esm/server/auth/handlers/{authorize,register,revoke,token}.js`). Those
serve the HTTP transports. This server uses `StdioServerTransport`, and
`dist/esm/server/index.js` contains no reference to `auth/handlers` — verified by
grep against the installed package, not inferred from the dependency graph.

### Why `fast-uri` has no attack surface here

This one *is* loaded: `server/index.js` imports `AjvJsonSchemaValidator`, which
imports `ajv`, which uses `fast-uri` for `format: "uri"` validation. So unlike
`ip-address` it genuinely executes.

It still has nowhere to go. The advisories describe host confusion when parsing a
URI — dangerous when a parsed host then drives an outbound request, which is the
SSRF shape. This server:

- declares **no** `format: "uri"`, `"url"` or `"hostname"` in any tool schema, so
  nothing routes untrusted input through the vulnerable parser, and
- makes **no `fetch()` calls at all** — it answers from atlas data bundled at
  publish time, so there is no request for a confused host to redirect.

## Why this is not fixed here

It cannot be. `overrides` in a published package apply to that package's own
installs, not to consumers, who resolve the SDK's transitive tree themselves.
Raising a version here would clean up a local `npm audit` and change nothing for
anyone who installs this package — the appearance of a fix rather than a fix.

The real remedy is upstream: the SDK bumping `ajv` and `express-rate-limit`, or
moving its HTTP/OAuth dependencies to optional so stdio consumers never install
them.

## What was actually done

The declared range moved from `^1.29.0` to `^1.30.0`. This raises the floor and
keeps the package current per the SOAK-AND-ROT policy; it does **not** resolve
the advisories above, and 1.30.0 was measured to leave both HIGHs in place.

Worth being precise about, because it was initially recorded the other way round:
a tooling sweep reported that 1.30.0 "closes 2 HIGH SSRF-class CVEs." Installing
1.30.0 and re-running `npm audit` shows both still present. The bump is hygiene,
not a security fix, and it should not be cited as one.

Note also that `^1.29.0` already permitted 1.30.0, so consumers installing before
this change were resolving to it anyway. The floor bump prevents a consumer
pinning something older; it does not deliver a newer SDK to anyone.
