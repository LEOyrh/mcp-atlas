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
import {
  atlas,
  atlasIndex,
  slugify,
  countySlugFromName,
} from "@urbankitstudio/atlas";
import type { CountyRecord, EndpointRecord } from "@urbankitstudio/atlas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ownerFieldFrom(endpoint: EndpointRecord): string | null {
  const f = endpoint.searchFields.find((sf) =>
    /owner|taxpayer|taxname/i.test(sf.name)
  );
  return f?.name ?? null;
}

function buildArcgisOwnerQuery(endpoint: EndpointRecord, ownerQuery: string): string {
  const field = ownerFieldFrom(endpoint);
  if (!field) return "";
  const where = `UPPER(${field}) LIKE UPPER('%25${encodeURIComponent(ownerQuery)}%25')`;
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
            const ownerField = ownerFieldFrom(ep);
            const searchable = ep.searchFields
              .filter((sf) => sf.searchable)
              .map((sf) => `${sf.name} (${sf.label})`)
              .join(", ");
            return [
              `  URL: ${ep.url}`,
              `  Service: ${ep.serviceType}/layer ${ep.layerIndex}`,
              `  Status: ${ep.status}`,
              `  Searchable fields: ${searchable || "none"}`,
              `  Owner field: ${ownerField ?? "none (PIN-only county)"}`,
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
  { name: "mcp-atlas", version: "0.1.0" },
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
      "Returns all counties in the UrbanKit Atlas that have a verified ArcGIS REST parcel endpoint. Pass a state abbreviation (e.g. 'IL') or state name (e.g. 'Illinois') to filter by state. Omit state to list all ~137 counties.",
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
        const ownerCoverage = c.endpoints.some((ep) => ownerFieldFrom(ep))
          ? "owner+APN"
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
    title: "Find a county by name or FIPS",
    description:
      "Fuzzy-matches a county by name (e.g. 'Kane', 'Cook County', 'Cook County IL') or by 5-digit FIPS code. Returns endpoint URLs, searchable field names, owner field, sample query URL, and license info.",
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
    title: "Get parcel ArcGIS REST endpoint",
    description:
      "Returns the full ArcGIS REST service URL, layer index, searchable field names, owner field, a ready sample ?where=…&f=json query, and the UrbanKit deep-link for a specific county.",
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
      const ownerField = ownerFieldFrom(ep);
      const sampleOwnerUrl = ownerField
        ? buildArcgisOwnerQuery(ep, "SMITH")
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
      lines.push(`  Owner field: ${ownerField ?? "NONE — PIN-only county"}`);
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
    title: "Build ArcGIS owner name query URL",
    description:
      "Constructs the exact ArcGIS REST query URL using that county's verified owner/taxpayer field. Returns a URL you can open in a browser or fetch directly. The query uses UPPER(field) LIKE UPPER('%NAME%') — case-insensitive partial match.",
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
      const ownerField = ownerFieldFrom(ep);
      if (!ownerField) {
        results.push(
          `Endpoint: ${ep.url}\nNote: No owner/taxpayer field available in this county — PIN-only lookup. Try searching by parcel number instead.`
        );
        continue;
      }

      const queryUrl = buildArcgisOwnerQuery(ep, owner_name);
      const where = `UPPER(${ownerField}) LIKE UPPER('%${owner_name}%')`;

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
