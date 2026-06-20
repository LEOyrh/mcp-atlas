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
