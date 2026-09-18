/**
 * Print what an MCP client is actually told about a county that publishes no
 * owner name. Not a test - a way to read the words a user sees, because the
 * whole point of the change is the wording.
 *
 *   node test/show-owner-unavailable.mjs [state] [county]
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const server = resolve(__dirname, "../dist/server.js");
const STATE = process.argv[2] ?? "MI";
const COUNTY = process.argv[3] ?? "Oakland";

const proc = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "inherit"] });

function send(id, method, params = {}) {
  proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
}

async function read() {
  return new Promise((res) => {
    let buf = "";
    const on = (c) => {
      buf += c.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        proc.stdout.off("data", on);
        res(JSON.parse(buf.slice(0, nl)));
      }
    };
    proc.stdout.on("data", on);
  });
}

send(1, "initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "show", version: "1" },
});
await read();
proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

send(2, "tools/call", { name: "list_counties", arguments: { state: STATE } });
const list = await read();
const row = (list.result?.content?.[0]?.text ?? "")
  .split("\n")
  .find((l) => l.includes(COUNTY));
console.log(`\n--- list_counties (${STATE}) ---\n${row ?? "not found"}`);

send(3, "tools/call", { name: "build_owner_query", arguments: { state: STATE, county: COUNTY, owner_name: "SMITH" } });
const q = await read();
console.log(`\n--- build_owner_query (${COUNTY}, "SMITH") ---\n${q.result?.content?.[0]?.text ?? ""}`);

proc.stdin.end();
proc.kill();
