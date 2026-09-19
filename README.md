# @urbankitstudio/mcp-atlas

[![mcp-atlas MCP server](https://glama.ai/mcp/servers/LEOyrh/mcp-atlas/badges/card.svg)](https://glama.ai/mcp/servers/LEOyrh/mcp-atlas)
[![Socket Badge](https://badge.socket.dev/npm/package/@urbankitstudio/mcp-atlas)](https://socket.dev/npm/package/@urbankitstudio/mcp-atlas)

Query the verified parcel ArcGIS REST endpoints of 171 counties across all 50 US states (174 layers) for owner, APN and address lookup via the Model Context Protocol (MCP).

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants direct access to UrbanKit Studio's atlas of manually verified county parcel GIS services. Ask Claude or Cursor to find the ArcGIS REST endpoint for any covered county, get the exact owner-search query URL, and look up parcel data — without needing to know anything about ArcGIS REST API conventions.

**Coverage:** 171 counties across all 50 US states, 174 verified endpoints (atlas 0.6.2).

---

## Quick start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "mcp-atlas": {
      "command": "npx",
      "args": ["-y", "@urbankitstudio/mcp-atlas"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "mcp-atlas": {
      "command": "npx",
      "args": ["-y", "@urbankitstudio/mcp-atlas"]
    }
  }
}
```

### Install globally (optional)

```sh
npm install -g @urbankitstudio/mcp-atlas
```

Then use `mcp-atlas` as the command instead of `npx -y @urbankitstudio/mcp-atlas`.

---

## Tools

The four tools are one pipeline, and what separates them is how precisely you
can already name the county:

| You have | Use | You get |
|---|---|---|
| A state, or nothing | `list_counties` | Which counties are covered, and whether owner search works there. No URLs. |
| A vague, misspelled or FIPS reference | `find_county` | Every county that reference matches, named, each with its record |
| An exact state and county | `get_parcel_endpoint` | That one county's endpoint URL, layer, fields and sample query |
| A county and an owner's name | `build_owner_query` | A runnable URL that searches for that name |

`find_county` and `get_parcel_endpoint` return the same per-county record. They
differ in how you address the county: `find_county` accepts an uncertain
reference and may come back with several candidates, `get_parcel_endpoint`
takes an exact pair and answers about one. If you already know the county, skip
`find_county`.

This server never executes a query and returns no parcel records. It tells you
the URL to fetch; fetching it is yours to do.

### `list_counties`

Browse coverage. Answers "is this county covered?" and "what can I search
there?" — one line per county, with no endpoint URLs or field names.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `state` | string | No | Two-letter abbreviation (`IL`) or full name (`Illinois`) |

**Example prompt:** "List all covered counties in Illinois"

**Example output:**
```
ST | County               | Slug                     | Coverage
--------------------------------------------------------------------
IL | Kane                 | kane-county              | owner+APN
IL | Cook                 | cook-county              | APN only
IL | DuPage               | dupage-county            | owner+APN
...
```

---

### `find_county`

Resolves a reference you cannot state exactly. Fuzzy-matches a partial or
misspelled name, a "County State" phrase, or a 5-digit FIPS code against every
covered county, and names each county it matched so an ambiguous reference
comes back as a list to choose from. Each match carries that county's record:
endpoint URLs, searchable field names, owner field, sample query, license.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | County name (`Kane`), name+state (`Kane IL`), or FIPS (`17089`) |

**Example prompt:** "Find the parcel endpoint for Kane County Illinois"

---

### `get_parcel_endpoint`

The default lookup once the county is known. Returns the full ArcGIS REST URL,
layer index, searchable fields, owner field, a generic sample `?where=…&f=json`
query and the UrbanKit deep-link for one county. For a named owner, use
`build_owner_query` rather than editing the sample query by hand.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `state` | string | Yes | Two-letter abbreviation or full name |
| `county` | string | Yes | County name (`Kane` or `Kane County`) |

**Example prompt:** "Give me the ArcGIS REST endpoint for Cook County Illinois"

---

### `build_owner_query`

The only tool that searches for a named owner. Fills a person or company name
into the county's verified owner/taxpayer field as
`UPPER(field) LIKE UPPER('%NAME%')`, a case-insensitive partial match, and
returns a URL you can fetch or open. A county that publishes no owner name is
refused here, with the reason, rather than handed a query that finds nothing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `state` | string | Yes | Two-letter abbreviation or full name |
| `county` | string | Yes | County name |
| `owner_name` | string | Yes | Owner/taxpayer name (partial match) |

**Example prompt:** "Build an ArcGIS query for properties owned by 'Smith' in Kane County IL"

**Example output:**
```
County:       Kane, Illinois
Owner field:  TaxName
WHERE clause: UPPER(TaxName) LIKE UPPER('%SMITH%')

Query URL:
https://gistech.countyofkane.org/arcgis/rest/services/KanePINList/MapServer/0/query
  ?where=UPPER(TaxName)%20LIKE%20UPPER('%25SMITH%25')
  &outFields=PIN,TaxName,SiteAddress,SiteCity,MailingAddress
  &returnGeometry=false&f=json&resultRecordCount=25
```

---

## Example conversation

> **User:** I'm doing due diligence on properties in Kane County, Illinois. Can you find all parcels owned by "Blackstone"?

> **Claude (using mcp-atlas):**
> 1. Calls `get_parcel_endpoint` → gets the `gistech.countyofkane.org` URL and confirms the owner field is `TaxName`
> 2. Calls `build_owner_query` with `owner_name=Blackstone` → returns a ready fetch URL
> 3. Optionally fetches the URL and formats the parcel results

---

## Atlas coverage

The atlas is maintained by [UrbanKit Studio](https://urbankitstudio.com/parcel-atlas). All endpoints are manually verified. Counties with an owner/taxpayer field support full name-based lookups; PIN-only counties support APN/parcel-number queries.

Full coverage map: https://urbankitstudio.com/parcel-atlas

---

## Data

Atlas data is embedded in the package (no network calls at startup). The underlying `@urbankitstudio/atlas` SDK is also published separately for programmatic use.

---

## What Socket flags, and how much of it is ours

[Socket](https://socket.dev/npm/package/@urbankitstudio/mcp-atlas)'s supply-chain scanner
rates this package in the mid-70s. Clicking through shows a long alert list. Each alert,
checked rather than waved away:

| Alert | Whose | What it is |
|---|---|---|
| `usesEval` | Not ours | No `eval` or `new Function` anywhere in `src/`. It comes from a dependency. |
| `unmaintained` (21) | Not ours | Transitive dependencies last published 2017–2021. |
| `mixedLicense` | Not ours | A dependency published as `BSD-3-Clause AND ISC`. |
| `noTests` | Ours, by design | `files` ships `dist` only. The suite lives in `test/` and runs in CI. Shipping tests inside the tarball would be the defect. |
| `networkAccess`, `filesystemAccess`, `envVars`, `shellAccess` | Ours | An MCP server talks to a client over stdio and reads its own config. A server without these could not do the job. |
| `unpopularPackage`, `noV1` | Ours | Download count and a `0.x` version. Both resolve with time, neither is a code issue. |

Vulnerability and license both come back at **100**, quality at **99**. The number the
badge shows is the *supply-chain* sub-score, and its single largest deduction is download
count, a popularity measure wearing a security badge's clothes. Judge the list above, not
the digit.

The four access alerts are what let the server read its own config and talk to a client
over stdio, nothing more. It still never executes a query or returns a parcel record.

## License

MIT — © 2026 UrbanKit Studio
