#!/usr/bin/env node
/**
 * @urbankitstudio/mcp-atlas
 *
 * MCP server exposing UrbanKit Studio's verified county parcel ArcGIS REST atlas.
 * Runs over stdio — compatible with Claude Desktop, Cursor, and any MCP client.
 *
 * Tools:
 *   list_counties       – list covered counties (optional state filter)
 *   find_county         – fuzzy-match a county, return endpoints + searchable fields
 *   get_parcel_endpoint – return the full REST service URL + ready sample query
 *   build_owner_query   – construct exact ArcGIS REST query for an owner name
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import {
  atlas,
  atlasIndex,
  slugify,
  countySlugFromName,
  isReviewedUnservable,
  reviewedCapability,
} from "@urbankitstudio/atlas";

const PKG_VERSION: string = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
).version;
import type { CountyRecord, EndpointRecord } from "@urbankitstudio/atlas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The owner column a caller can actually USE, or null with a reason.
 *
 * Matching the column name is not enough, and that gap cost a real trial user:
 * they paid for owner data, ran Los Angeles County, got nothing back, and the
 * atlas had said the field was there the whole time. Fourteen counties in the
 * registry document an owner column that is present and empty on every row -
 * New Jersey's statewide layer publishes OWNER_NAME blank across 3,481,240
 * rows, New York's across 3,827,530 - and a reviewed capability record says so.
 * Consult it BEFORE promising the field.
 */
function ownerFieldFor(
  county: CountyRecord,
  endpoint: EndpointRecord,
): { field: string | null; unavailableReason: string | null } {
  if (isReviewedUnservable(county, "owner_name")) {
    const reviewed = reviewedCapability(county, "owner_name");
    return {
      field: null,
      unavailableReason:
        reviewed?.basis?.note ??
        "this county publishes no usable owner name on its public endpoint",
    };
  }
  const f = endpoint.searchFields.find((sf) =>
    /owner|taxpayer|taxname/i.test(sf.name)
  );
  return { field: f?.name ?? null, unavailableReason: null };
}

/** Back-compat shim for call sites that only need the column. */
function ownerFieldFrom(county: CountyRecord, endpoint: EndpointRecord): string | null {
  return ownerFieldFor(county, endpoint).field;
}

/**
 * An ArcGIS `where` is SQL, and a single quote closes the string literal.
 * encodeURIComponent does not help: `'` and `)` are both in its unreserved set, so
 * `A') OR 1=1 --` passes through encoding intact and lands OUTSIDE the quotes as a
 * live predicate against a county's server. Doubling the quote is the SQL-standard
 * escape and keeps the whole input inside the literal where it belongs.
 *
 * Every caller that puts user text in a `where` goes through this, including the
 * clause rendered for a human to copy: escaping only the URL would leave the same
 * payload one paste away from running.
 */
export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function buildArcgisOwnerQuery(
  county: CountyRecord,
  endpoint: EndpointRecord,
  ownerQuery: string,
): string {
  const field = ownerFieldFrom(county, endpoint);
  if (!field) return "";
  const where = `UPPER(${field}) LIKE UPPER('%25${encodeURIComponent(escapeSqlLiteral(ownerQuery))}%25')`;
  const liveFields = endpoint.searchFields
    .filter((sf) => sf.searchable)
    .map((sf) => sf.name)
    .join(",");
  return (
    `${endpoint.url}/query` +
    `?where=${where}` +
    `&outFields=${liveFields}` +
    `&returnGeometry=false` +
    `&f=json` +
    `&resultRecordCount=25`
  );
}

function formatCountySummary(c: CountyRecord): string {
  const epSummary =
    c.endpoints.length === 0
      ? "no REST endpoint mapped"
      : c.endpoints
          .map((ep) => {
            const owner = ownerFieldFor(c, ep);
            const searchable = ep.searchFields
              .filter((sf) => sf.searchable)
              .map((sf) => `${sf.name} (${sf.label})`)
              .join(", ");
            return [
              `  URL: ${ep.url}`,
              `  Service: ${ep.serviceType}/layer ${ep.layerIndex}`,
              `  Status: ${ep.status} (verified ${ep.lastVerified})`,
              `  Searchable fields: ${searchable || "none"}`,
              `  Owner field: ${
                owner.field ??
                (owner.unavailableReason
                  ? `NOT AVAILABLE - ${owner.unavailableReason}`
                  : "none (this layer publishes no owner column)")
              }`,
              `  License: ${ep.license}`,
            ].join("\n");
          })
          .join("\n---\n");
  return [
    `${c.county}, ${c.stateName} (${c.state})`,
    `FIPS: ${c.countyFips ?? "n/a"}`,
    `Endpoints (${c.endpoints.length}):`,
    epSummary,
    c.notes ? `Notes: ${c.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer(
  // Read from package.json rather than restated here. This line said 0.1.0
  // while the package was 0.1.6 - six releases of drift, and every MCP client
  // that asked the server its version got the wrong answer.
  { name: "mcp-atlas", version: PKG_VERSION },
  {
    instructions:
      "UrbanKit Atlas MCP server. Use list_counties to discover coverage, find_county or get_parcel_endpoint to get the ArcGIS REST URL, and build_owner_query to construct a ready-to-fire owner-name lookup URL.",
  }
);

// ---------------------------------------------------------------------------
// Tool: list_counties
// ---------------------------------------------------------------------------

server.registerTool(
  "list_counties",
  {
    title: "List covered counties",
    description:
      `Browse what the atlas covers. Answers "is this county covered?" and "what can I search there?" with one line per county: state, name, slug, and whether owner-name search is available or the county publishes parcel numbers only. Deliberately returns NO endpoint URLs or field names; call get_parcel_endpoint for one county's technical record. Filter with a state abbreviation ('IL') or name ('Illinois'), or omit state for all ~${atlas.totals.counties} counties.`,
    inputSchema: {
      state: z
        .string()
        .optional()
        .describe(
          "Optional: two-letter state abbreviation (e.g. 'IL') or full state name (e.g. 'Illinois')"
        ),
    },
  },
  ({ state }) => {
    const stateFilter = state?.trim().toLowerCase();

    const rows: string[] = [];

    for (const stateEntry of atlasIndex.states) {
      if (!stateEntry.populated) continue;

      // Filter by state if provided
      if (stateFilter) {
        const matchAbbrev = stateEntry.abbrev.toLowerCase() === stateFilter;
        const matchName = stateEntry.name.toLowerCase() === stateFilter;
        const matchSlug = stateEntry.slug === slugify(stateFilter);
        if (!matchAbbrev && !matchName && !matchSlug) continue;
      }

      const stateFile = atlas.byStateSlug.get(stateEntry.slug);
      if (!stateFile) continue;

      const covered = stateFile.counties.filter(
        (c) => c.endpoints.length > 0
      );
      for (const c of covered) {
        // "APN only" is not the same claim as "owner+APN minus the owner".
        // A caller scanning this column is deciding whether to spend a request,
        // so a county whose owner column exists and is empty must not read as
        // though owners are simply absent from the schema.
        const anyOwner = c.endpoints.some((ep) => ownerFieldFor(c, ep).field);
        const ownerWithheld = c.endpoints.some(
          (ep) => ownerFieldFor(c, ep).unavailableReason,
        );
        const ownerCoverage = anyOwner
          ? "owner+APN"
          : ownerWithheld
            ? "APN only (county publishes no owner name)"
            : "APN only";
        rows.push(
          `${c.state} | ${c.county.padEnd(20)} | ${c.countySlug.padEnd(24)} | ${ownerCoverage}`
        );
      }
    }

    if (rows.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: stateFilter
              ? `No covered counties found for state "${state}". Check state name/abbreviation.`
              : "No counties found (unexpected — check atlas data).",
          },
        ],
      };
    }

    const header =
      "ST | County               | Slug                     | Coverage";
    const divider = "-".repeat(header.length);
    const totals = `\nTotal: ${rows.length} counties`;

    return {
      content: [
        {
          type: "text" as const,
          text: [header, divider, ...rows, divider, totals].join("\n"),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: find_county
// ---------------------------------------------------------------------------

server.registerTool(
  "find_county",
  {
    title: "Resolve an uncertain county reference",
    description:
      "Use when you do NOT already know the exact state and county. Fuzzy-matches one free-text reference ('Kane', 'Cook County IL', a misspelling, or a 5-digit FIPS code) against every covered county and names each county it matched, so an ambiguous reference comes back as a list to choose from rather than a silent guess. Each match carries that county's technical record, the same record get_parcel_endpoint returns for one county. Call get_parcel_endpoint directly whenever you already hold an exact state and county; come here only to turn a vague, misspelled or coded reference into definite ones.",
    inputSchema: {
      query: z
        .string()
        .min(2)
        .describe(
          "County name, 'County Name State' (e.g. 'Kane IL'), or 5-digit FIPS code"
        ),
    },
  },
  ({ query }) => {
    const q = query.trim().toLowerCase();

    // FIPS lookup
    const isFips = /^\d{5}$/.test(q);

    const matches: CountyRecord[] = [];

    for (const stateEntry of atlasIndex.states) {
      if (!stateEntry.populated) continue;
      const stateFile = atlas.byStateSlug.get(stateEntry.slug);
      if (!stateFile) continue;

      for (const county of stateFile.counties) {
        if (isFips) {
          if (county.countyFips === q) matches.push(county);
          continue;
        }

        // Parse optional state suffix: "Kane IL" or "Kane Illinois"
        let countyPart = q;
        let statePart: string | null = null;
        const spaceIdx = q.lastIndexOf(" ");
        if (spaceIdx > 0) {
          const last = q.slice(spaceIdx + 1);
          if (last.length === 2 || last.length > 3) {
            countyPart = q.slice(0, spaceIdx);
            statePart = last;
          }
        }

        if (statePart) {
          const stateOk =
            stateEntry.abbrev.toLowerCase() === statePart ||
            stateEntry.name.toLowerCase() === statePart ||
            stateEntry.slug === slugify(statePart);
          if (!stateOk) continue;
        }

        const slug = countySlugFromName(countyPart);
        if (
          county.countySlug === slug ||
          county.county.toLowerCase() === countyPart ||
          county.county.toLowerCase().startsWith(countyPart)
        ) {
          matches.push(county);
        }
      }
    }

    if (matches.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              `No county matched "${query}".\n` +
              `Try: "Kane IL", "Cook County IL", "17031" (FIPS), or use list_counties to browse.`,
          },
        ],
      };
    }

    const text = matches.map(formatCountySummary).join("\n\n" + "=".repeat(60) + "\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: matches.length > 1 ? `${matches.length} matches:\n\n${text}` : text,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: get_parcel_endpoint
// ---------------------------------------------------------------------------

server.registerTool(
  "get_parcel_endpoint",
  {
    title: "Get one county's parcel endpoint record",
    description:
      "The default lookup once the county is known. Takes an exact state and county and returns that county's ArcGIS REST service URL, layer index, searchable field names, verified owner/taxpayer field, a generic sample ?where=…&f=json query, and the UrbanKit deep-link. If the county name is uncertain, misspelled, or you hold only a FIPS code, call find_county first. To search for a named person or company, call build_owner_query rather than editing the sample query by hand.",
    inputSchema: {
      state: z
        .string()
        .describe("Two-letter state abbreviation (e.g. 'IL') or full state name"),
      county: z
        .string()
        .describe("County name (e.g. 'Kane' or 'Kane County')"),
    },
  },
  ({ state, county }) => {
    const stateSlug = slugify(state.trim());
    const countySlug = countySlugFromName(county.trim());

    // Try exact slug match first, then abbrev match
    let countyRecord: CountyRecord | undefined;

    for (const stateEntry of atlasIndex.states) {
      if (!stateEntry.populated) continue;
      const abbrevMatch =
        stateEntry.abbrev.toLowerCase() === state.trim().toLowerCase();
      const slugMatch = stateEntry.slug === stateSlug;
      const nameMatch = stateEntry.name.toLowerCase() === state.trim().toLowerCase();
      if (!abbrevMatch && !slugMatch && !nameMatch) continue;

      const stateFile = atlas.byStateSlug.get(stateEntry.slug);
      if (!stateFile) continue;

      countyRecord = stateFile.counties.find(
        (c) => c.countySlug === countySlug
      );
      if (countyRecord) break;
    }

    if (!countyRecord) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              `County "${county}" not found in state "${state}".\n` +
              `Use list_counties or find_county to verify the name.`,
          },
        ],
      };
    }

    if (countyRecord.endpoints.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `${countyRecord.county}, ${countyRecord.stateName} is in the atlas but has no verified REST endpoint yet.`,
          },
        ],
      };
    }

    const lines: string[] = [
      `${countyRecord.county} County, ${countyRecord.stateName} (${countyRecord.state})`,
      `FIPS: ${countyRecord.countyFips ?? "n/a"}`,
      "",
    ];

    countyRecord.endpoints.forEach((ep, i) => {
      const owner = ownerFieldFor(countyRecord, ep);
      const ownerField = owner.field;
      const sampleOwnerUrl = ownerField
        ? buildArcgisOwnerQuery(countyRecord, ep, "SMITH")
        : null;

      lines.push(`Endpoint ${i + 1}:`);
      lines.push(`  URL:         ${ep.url}`);
      lines.push(`  Service:     ${ep.serviceType}`);
      lines.push(`  Layer index: ${ep.layerIndex}`);
      lines.push(`  Layer name:  ${ep.layerName}`);
      lines.push(`  Status:      ${ep.status} (verified ${ep.lastVerified})`);
      lines.push(`  CORS:        ${ep.corsEnabled === null ? "unknown" : ep.corsEnabled}`);
      lines.push(`  License:     ${ep.license}${ep.licenseUrl ? ` (${ep.licenseUrl})` : ""}`);
      lines.push("");
      lines.push("  Searchable fields:");
      ep.searchFields
        .filter((sf) => sf.searchable)
        .forEach((sf) => lines.push(`    ${sf.name.padEnd(20)} – ${sf.label}`));
      lines.push("");
      lines.push(
        `  Owner field: ${
          ownerField ??
          (owner.unavailableReason
            ? `NOT AVAILABLE - ${owner.unavailableReason}`
            : "NONE - this layer publishes no owner column")
        }`,
      );
      if (ep.sampleQuery) {
        lines.push("");
        lines.push("  Sample query (from atlas):");
        lines.push(`    ${ep.sampleQuery}`);
      }
      if (sampleOwnerUrl) {
        lines.push("");
        lines.push('  Sample owner query (SMITH — replace with target name):');
        lines.push(`    ${sampleOwnerUrl}`);
      }
      lines.push("");
      lines.push(
        `  UrbanKit deep-link: https://urbankitstudio.com/tools/parcel-lookup?endpoint=${encodeURIComponent(ep.url)}${ownerField ? `&fieldHint=${ownerField}` : ""}`
      );
      if (i < countyRecord.endpoints.length - 1) lines.push("\n" + "-".repeat(40));
    });

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: build_owner_query
// ---------------------------------------------------------------------------

server.registerTool(
  "build_owner_query",
  {
    title: "Build an owner-name search URL for one county",
    description:
      "The only tool that searches for a named owner. Fills a person or company name into that county's verified owner/taxpayer field as UPPER(field) LIKE UPPER('%NAME%'), a case-insensitive partial match, and returns a URL you can fetch or open in a browser. get_parcel_endpoint returns the endpoint and a generic sample query, not a name search, so come here for the name. This server does not execute the query and returns no parcel records: fetch the returned URL yourself. Counties that publish no owner name are refused here with that reason.",
    inputSchema: {
      state: z
        .string()
        .describe("Two-letter state abbreviation (e.g. 'IL') or full state name"),
      county: z
        .string()
        .describe("County name (e.g. 'Kane' or 'Kane County')"),
      owner_name: z
        .string()
        .min(2)
        .describe("Owner/taxpayer name to search for (partial match, case-insensitive)"),
    },
  },
  ({ state, county, owner_name }) => {
    const stateInput = state.trim();
    const countySlug = countySlugFromName(county.trim());

    let countyRecord: CountyRecord | undefined;

    for (const stateEntry of atlasIndex.states) {
      if (!stateEntry.populated) continue;
      const abbrevMatch =
        stateEntry.abbrev.toLowerCase() === stateInput.toLowerCase();
      const slugMatch = stateEntry.slug === slugify(stateInput);
      const nameMatch =
        stateEntry.name.toLowerCase() === stateInput.toLowerCase();
      if (!abbrevMatch && !slugMatch && !nameMatch) continue;

      const stateFile = atlas.byStateSlug.get(stateEntry.slug);
      if (!stateFile) continue;

      countyRecord = stateFile.counties.find(
        (c) => c.countySlug === countySlug
      );
      if (countyRecord) break;
    }

    if (!countyRecord) {
      return {
        content: [
          {
            type: "text" as const,
            text: `County "${county}" not found in state "${state}". Use find_county to verify.`,
          },
        ],
      };
    }

    const results: string[] = [];

    for (const ep of countyRecord.endpoints) {
      const owner = ownerFieldFor(countyRecord, ep);
      const ownerField = owner.field;
      if (!ownerField) {
        // Refusing with the reason beats handing back a query that returns zero
        // rows forever. The caller can then choose a different county or a
        // different field instead of concluding the owner simply is not there.
        results.push(
          owner.unavailableReason
            ? `Endpoint: ${ep.url}\nOWNER NAME NOT AVAILABLE for ${countyRecord.county}, ${countyRecord.stateName}: ${owner.unavailableReason}\nNo owner query is possible here. Search by parcel number or address instead, or pick a county whose coverage reads owner+APN in list_counties.`
            : `Endpoint: ${ep.url}\nNote: this layer publishes no owner or taxpayer column - PIN-only lookup. Try searching by parcel number instead.`
        );
        continue;
      }

      const queryUrl = buildArcgisOwnerQuery(countyRecord, ep, owner_name);
      const where = `UPPER(${ownerField}) LIKE UPPER('%${escapeSqlLiteral(owner_name)}%')`;

      results.push(
        [
          `County:      ${countyRecord.county}, ${countyRecord.stateName}`,
          `Owner field: ${ownerField}`,
          `WHERE clause: ${where}`,
          ``,
          `Query URL:`,
          queryUrl,
          ``,
          `Notes:`,
          `  - Returns up to 25 records`,
          `  - Partial name match (e.g. "SMITH" matches "SMITH JOHN" and "BLACKSMITH LLC")`,
          `  - Case-insensitive`,
          `  - Add &token=<your-token> if the service requires auth (this county is public)`,
        ].join("\n")
      );
    }

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `${countyRecord.county}, ${countyRecord.stateName} has no REST endpoints in the atlas yet.`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text" as const, text: results.join("\n\n" + "=".repeat(60) + "\n\n") }],
    };
  }
);

// ---------------------------------------------------------------------------
// Connect and run
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP protocol runs over stdin/stdout; stderr is safe for diagnostics
  process.stderr.write("mcp-atlas server started (stdio)\n");
}

main().catch((err: unknown) => {
  process.stderr.write(
    `mcp-atlas fatal error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
