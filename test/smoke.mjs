/**
 * Smoke test for @urbankitstudio/mcp-atlas
 *
 * Spawns the built server as a child process, sends MCP initialize +
 * a list_counties call, and verifies the response contains real atlas data.
 *
 * Usage:  node test/smoke.mjs
 * Or via: npm run smoke
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(__dirname, "../dist/server.js");

let exitCode = 0;

/** Send a JSON-RPC message (newline-delimited) to the server's stdin */
function sendMessage(proc, id, method, params = {}) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  proc.stdin.write(msg + "\n");
}

/** Collect a parsed JSON-RPC response from the server's stdout */
async function readResponse(proc) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString();
      // Responses are newline-delimited
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        proc.stdout.off("data", onData);
        try {
          resolve(JSON.parse(buf.slice(0, nl)));
        } catch (e) {
          reject(new Error(`Bad JSON: ${buf.slice(0, nl)}`));
        }
      }
    };
    proc.stdout.on("data", onData);
    // Timeout after 5 s
    setTimeout(() => {
      proc.stdout.off("data", onData);
      reject(new Error("Timeout waiting for server response"));
    }, 5000);
  });
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    exitCode = 1;
  } else {
    console.log("PASS:", msg);
  }
}

async function run() {
  const proc = spawn("node", [serverEntry], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stderr.on("data", (d) => {
    process.stderr.write("[server] " + d.toString());
  });

  proc.on("error", (err) => {
    console.error("Failed to start server:", err.message);
    exitCode = 1;
  });

  // Step 1: initialize
  sendMessage(proc, 1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.1" },
  });
  const initResp = await readResponse(proc);
  assert(initResp.result?.serverInfo?.name === "mcp-atlas", "server name is mcp-atlas");

  // Step 2: initialized notification
  proc.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"
  );

  // Step 3: list tools
  sendMessage(proc, 2, "tools/list", {});
  const toolsResp = await readResponse(proc);
  const toolNames = (toolsResp.result?.tools ?? []).map((t) => t.name);
  assert(toolNames.includes("list_counties"), "list_counties tool registered");
  assert(toolNames.includes("find_county"), "find_county tool registered");
  assert(toolNames.includes("get_parcel_endpoint"), "get_parcel_endpoint tool registered");
  assert(toolNames.includes("build_owner_query"), "build_owner_query tool registered");

  // Step 4: call list_counties with state=IL
  sendMessage(proc, 3, "tools/call", {
    name: "list_counties",
    arguments: { state: "IL" },
  });
  const listResp = await readResponse(proc);
  const listText = listResp.result?.content?.[0]?.text ?? "";
  assert(listText.includes("IL"), "list_counties returns Illinois entries");
  assert(listText.includes("Kane"), "list_counties includes Kane County");

  // Step 5: call find_county for Kane IL
  sendMessage(proc, 4, "tools/call", {
    name: "find_county",
    arguments: { query: "Kane IL" },
  });
  const findResp = await readResponse(proc);
  const findText = findResp.result?.content?.[0]?.text ?? "";
  assert(findText.includes("gistech.countyofkane.org"), "find_county returns Kane REST URL");
  assert(findText.includes("TaxName"), "find_county returns owner field TaxName");

  // Step 6: build_owner_query for Kane IL, SMITH
  sendMessage(proc, 5, "tools/call", {
    name: "build_owner_query",
    arguments: { state: "IL", county: "Kane", owner_name: "SMITH" },
  });
  const queryResp = await readResponse(proc);
  const queryText = queryResp.result?.content?.[0]?.text ?? "";
  assert(queryText.includes("TaxName"), "build_owner_query uses TaxName field");
  assert(queryText.includes("UPPER(TaxName)"), "build_owner_query uses UPPER() wrapper");
  assert(queryText.includes("SMITH"), "build_owner_query includes owner name");

  // Step 6b: an owner name cannot escape the SQL string literal.
  //
  // A `where` is SQL and a single quote closes the literal. encodeURIComponent is
  // not an escape here: `'` and `)` are both unreserved, so `A') OR 1=1 --` used to
  // pass through intact and arrive at a county's ArcGIS server as a well-formed
  // predicate with the tail commented out. Nothing of ours is at risk - the server
  // executes nothing and holds no credentials - but the payload ships in a public
  // npm package and points at third-party government endpoints, and the realistic
  // route is indirect prompt injection steering a client into the call.
  //
  // Both outputs are checked because there are two of them: the URL, and the WHERE
  // clause printed for a human to paste. Escaping one and not the other is the same
  // bug with a longer path to it.
  sendMessage(proc, 51, "tools/call", {
    name: "build_owner_query",
    arguments: { state: "IL", county: "Kane", owner_name: "A') OR 1=1 --" },
  });
  const injResp = await readResponse(proc);
  const injText = injResp.result?.content?.[0]?.text ?? "";
  // Assert on the bytes the user actually receives rather than decoding: the
  // output legitimately contains bare `%` LIKE wildcards, so decodeURIComponent
  // throws on it. Folding %20 back to a space is all that is needed to compare
  // the URL copy and the printed clause against the same shape.
  const injFlat = injText.replace(/%20/g, " ");
  // Twice, not once: the URL and the printed clause are built separately, so a
  // single occurrence means one of the two paths escaped and the other did not.
  // Asserting mere presence passed under both halves of the sabotage proof.
  assert(
    injText.split("A'')").length - 1 === 2,
    "build_owner_query doubles the quote in BOTH the URL and the printed WHERE clause",
  );
  assert(
    !injFlat.includes("A') OR"),
    "build_owner_query leaves no closed literal followed by an injected OR, in either the URL or the printed WHERE clause",
  );

  // Step 7: THE CASE THAT COST A REAL USER.
  //
  // Oakland County MI documents NAME1 and NAME2 as owner columns, and neither
  // carries a value in any record sampled; the atlas carries a reviewed
  // not_published record for it. Before this, list_counties called such a
  // county "owner+APN", find_county printed the column as usable, and
  // build_owner_query handed back a query returning zero rows forever - so
  // the only way to find out was to spend a request and get nothing. Five
  // other counties share the shape in atlas 0.6.2.
  //
  // This fixture was Wake County NC until 2026-09-02. Wake's "empty OWNER
  // column" advisory came from an audit predicate that compared against NULL
  // and was reverted before atlas 0.6.1: Wake publishes owner names on
  // 437,715 rows, and no published atlas carries an override for it.
  sendMessage(proc, 6, "tools/call", {
    name: "list_counties",
    arguments: { state: "MI" },
  });
  const miResp = await readResponse(proc);
  const miText = miResp.result?.content?.[0]?.text ?? "";
  const oaklandRow = miText.split("\n").find((l) => l.includes("Oakland")) ?? "";
  assert(oaklandRow.length > 0, "list_counties includes Oakland County");
  assert(
    oaklandRow.includes("publishes no owner name"),
    "list_counties SAYS Oakland publishes no owner name",
  );
  assert(!oaklandRow.includes("owner+APN"), "list_counties does not claim owner+APN for Oakland");

  sendMessage(proc, 7, "tools/call", {
    name: "find_county",
    arguments: { query: "Oakland MI" },
  });
  const oaklandFind = await readResponse(proc);
  const oaklandFindText = oaklandFind.result?.content?.[0]?.text ?? "";
  assert(
    oaklandFindText.includes("NOT AVAILABLE"),
    "find_county states Oakland's owner field is not available",
  );

  sendMessage(proc, 8, "tools/call", {
    name: "build_owner_query",
    arguments: { state: "MI", county: "Oakland", owner_name: "SMITH" },
  });
  const oaklandQuery = await readResponse(proc);
  const oaklandQueryText = oaklandQuery.result?.content?.[0]?.text ?? "";
  assert(
    oaklandQueryText.includes("OWNER NAME NOT AVAILABLE"),
    "build_owner_query REFUSES for Oakland instead of returning a dud query",
  );
  assert(
    !oaklandQueryText.includes("UPPER(NAME1)"),
    "build_owner_query does not hand back an owner WHERE clause for Oakland",
  );

  // Cleanup
  proc.stdin.end();
  proc.kill();

  if (exitCode === 0) {
    console.log("\nAll smoke tests passed.");
  } else {
    console.error("\nOne or more smoke tests failed.");
  }

  process.exit(exitCode);
}

run().catch((err) => {
  console.error("Smoke test error:", err.message);
  process.exit(1);
});
