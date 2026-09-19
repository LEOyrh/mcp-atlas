# @urbankitstudio/mcp-atlas Changelog

This package did not previously carry a changelog. 0.1.0 through 0.1.5 below
are reconstructed from `npm view @urbankitstudio/mcp-atlas@<version>` metadata
and tarball diffs (`npm pack` + `diff`) during the 2026-07-20 repo
reconciliation, since none of those publishes had a corresponding commit in
this monorepo to draw from.

## 0.2.2 — 2026-09-18

Tool descriptions rewritten, plus one security fix. The same four tools take the
same parameters and return the same shape of payload.

- **An owner name can no longer escape the SQL string literal.**
  `build_owner_query` put the caller's text into an ArcGIS `where` clause behind
  nothing but `encodeURIComponent`, which is not an escape here: `'` and `)` are
  both in its unreserved set, so `A') OR 1=1 --` passed through intact and
  arrived at a county's server as a well-formed predicate with the tail
  commented out. The same payload was rendered unencoded in the `WHERE clause:`
  line users are invited to copy. Single quotes are now doubled, the
  SQL-standard escape, in both outputs. Nothing in this package was at risk: it
  executes no query, stores no data and holds no credentials. The endpoints the
  query names are third-party government servers, and the realistic route was
  indirect prompt injection steering a client into making the call.

- **Each tool description now says when to use it and which tool to use
  instead.** Glama's tool-definition scan scored disambiguation 2 out of 5:
  "find_county and get_parcel_endpoint overlap heavily: both return endpoint
  URLs, searchable fields, owner fields, and sample query URLs. list_counties
  and find_county also both identify counties, so the tool boundaries are not
  clearly distinct." That reading was correct. The two do return the same
  per-county record, and nothing in either description told an agent how to
  choose. What actually separates them is how precisely the caller can already
  name the county, and none of the four descriptions said so.
- `find_county` is now described by what only it does: resolve an uncertain,
  misspelled or FIPS-coded reference, and name every county it matched rather
  than guess one. `get_parcel_endpoint` is the exact-pair lookup and says to
  call `find_county` first when the name is uncertain. `list_counties` says it
  deliberately returns no URLs. `build_owner_query` says it is the only tool
  that searches for a named owner, and that this server never executes a query.
- README gains a four-row table for choosing a tool, and states the overlap
  outright instead of leaving a reader to find it.

## 0.2.1 — 2026-09-03

Metadata only. No behaviour change. The package author, the license holder
and the README credit now name UrbanKit Studio instead of an individual.

## 0.2.0 — 2026-09-02

- **Owner lookups say so before the request when a county publishes no owner
  name** (#540). `ownerFieldFrom()` decided a county had owners by matching
  the column name alone, so for the fourteen counties whose owner column
  exists and is empty, `list_counties` said "owner+APN", `find_county` and
  `get_parcel_endpoint` printed the field as usable, and `build_owner_query`
  returned a query that finds zero rows. Every one of those paths now asks
  the reviewed capability record first and prints, for Oakland County MI for
  example, "OWNER NAME NOT AVAILABLE … NAME1 and NAME2 … carry no value in
  any record sampled". The smoke fixture moves from Wake County NC to
  Oakland: Wake's advisory came from an audit predicate that compared
  against NULL and was reverted before atlas 0.6.1 (Wake publishes owner
  names on 437,715 rows).
- **Catch-up to atlas 0.6.2**: 171 counties across all 50 states, 174
  verified endpoints. Oregon's Multnomah entry no longer points at Umatilla
  County's tax lots (that layer now has its own Umatilla County entry), and
  Lane's entry records its 2026-09-01 outage.
- `@urbankitstudio/atlas` dependency `^0.5.1` → `^0.6.2`. A caret on a 0.x
  version pins the minor, so every 0.1.6 install kept resolving atlas 0.5.x
  (155 counties) however far the atlas moved; this is the release that moves
  the MCP server with it.
- `description` and `README.md` county counts 155 → 171.

## 0.1.6 — 2026-08-06

Published from this monorepo through the publish path #370 added (npm
`gitHead` aab7346). Dependencies at publish: `@modelcontextprotocol/sdk@^1.30.0`,
`@urbankitstudio/atlas@^0.5.1`. The two changes below had been sitting under
"Unreleased" since the 2026-07-20 reconciliation and shipped with it.

- `list_counties` tool description now interpolates `atlas.totals.counties`
  instead of a hardcoded count string, so it can't silently go stale again
  the next time the atlas grows past 155 counties.
- `dependencies["@urbankitstudio/atlas"]` floor raised to `^0.5.1` to make
  explicit that this copy is verified against the King County / Will County
  data patch (was `^0.5.0` in the last publish, itself already stale at
  `^0.4.0` in this monorepo's pre-reconciliation `package.json`).

## 0.1.5 — 2026-07-03

Published from the standalone `github.com/LEOyrh/mcp-atlas` repo (see the
0.1.2 entry below — this monorepo's `packages/mcp-atlas/` was not the source
for this or any of the 0.1.2–0.1.5 publishes).

- Catch-up to the atlas 0.5.0 resync (128 → 155 counties, all 50 states
  populated): `description` and `README.md` reworded, county-count mentions
  137 → 155, `@urbankitstudio/atlas` dependency `^0.4.0` → `^0.5.0`.

## 0.1.4 — 2026-06-21

- `mcpName` casing fix: `io.github.leoyrh/mcp-atlas` →
  `io.github.LEOyrh/mcp-atlas`. MCP registry namespace verification is
  case-sensitive against the GitHub account name; the 0.1.3 value would not
  have verified.

## 0.1.3 — 2026-06-21

- Added `mcpName: "io.github.leoyrh/mcp-atlas"` for MCP registry namespace
  ownership verification (corrected the next day — see 0.1.4).

## 0.1.2 — 2026-06-20

- `repository` field repointed from this monorepo (`LEOyrh/urbankitstudio`,
  directory `packages/mcp-atlas`) to the standalone `LEOyrh/mcp-atlas` repo.
  All publishes from this point through 0.1.5 shipped from that standalone
  repo, not this monorepo copy — the reason `packages/mcp-atlas/` here fell
  behind (see the 2026-07-20 reconciliation note below).

## 0.1.1 — 2026-06-20

- `bin.mcp-atlas` path fixed: `./dist/server.js` → `dist/server.js` (dropped
  the leading `./`, which some `npx`/global-bin resolution paths mishandled).

## 0.1.0 — 2026-06-20

- Initial public release. Four tools: `list_counties`, `find_county`,
  `get_parcel_endpoint`, `build_owner_query`.

---

## Repo reconciliation — 2026-07-20

`packages/mcp-atlas/package.json` in this monorepo had been stuck at 0.1.1
(the last version actually published from here) while npm's `latest` had
moved to 0.1.5, published from the standalone repo described in the 0.1.2
entry above. Reconciled this copy to match what is live:

- `version`: `0.1.1` → `0.1.5`.
- `description` / `README.md`: "137 verified... " / "128+ counties across 39
  US states" → "155 verified..." / "155 counties across all 50 US states",
  matching what 0.1.5 already shipped.
- `dependencies["@urbankitstudio/atlas"]`: `^0.4.0` → `^0.5.1` (0.1.5 shipped
  with `^0.5.0`; this floor is raised further to the atlas patch published
  alongside this reconciliation — see `packages/atlas/CHANGELOG.md` 0.5.1).

No new npm publish is required for this reconciliation by itself. Publish a
new `mcp-atlas` version only if the `Unreleased` section above (the dynamic
county-count string) is worth shipping on its own, or if a future change
needs one.
