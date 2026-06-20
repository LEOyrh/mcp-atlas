# @urbankitstudio/mcp-atlas

Query 137 verified US county parcel ArcGIS REST endpoints — owner/APN lookup — via MCP.

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants direct access to UrbanKit Studio's atlas of manually verified county parcel GIS services. Ask Claude or Cursor to find the ArcGIS REST endpoint for any covered county, get the exact owner-search query URL, and look up parcel data — without needing to know anything about ArcGIS REST API conventions.

**Coverage:** 128+ counties across 39 US states (v0.4.0 atlas, updated May 2026).

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

### `list_counties`

Lists all counties with a verified parcel REST endpoint.

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

Fuzzy-matches a county by name or 5-digit FIPS code. Returns endpoint URLs, searchable field names, owner field, sample query, and license info.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | County name (`Kane`), name+state (`Kane IL`), or FIPS (`17089`) |

**Example prompt:** "Find the parcel endpoint for Kane County Illinois"

---

### `get_parcel_endpoint`

Returns the full ArcGIS REST URL, layer index, searchable fields, owner field, and a ready sample `?where=…&f=json` query for a specific county.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `state` | string | Yes | Two-letter abbreviation or full name |
| `county` | string | Yes | County name (`Kane` or `Kane County`) |

**Example prompt:** "Give me the ArcGIS REST endpoint for Cook County Illinois"

---

### `build_owner_query`

Constructs the exact ArcGIS REST query URL using the county's verified owner/taxpayer field. Uses `UPPER(field) LIKE UPPER('%NAME%')` — case-insensitive partial match.

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

## License

MIT — © Leo Yong / UrbanKit Studio
