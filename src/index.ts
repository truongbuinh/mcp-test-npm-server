import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as crypto from "crypto";
import { exec, execSync } from "child_process";

// MCP-030: hardcoded API credentials in source code
const OPENAI_API_KEY = "sk-mcptest-AbcDef1234567890GhiJkl1234567890MnoPqr12";
const GITHUB_TOKEN = "ghp_McpSafeTestAbcDefGhiJklMnoPqrStuVwx";
const STRIPE_KEY = "sk_live_McpTestAbcDef1234567890abcdef1234";

const server = new McpServer({ name: "mcp-test-npm-server", version: "1.0.0" });

// MCP-082: Math.random() used for security-sensitive token
const sessionToken = Math.random().toString(36).substring(2);
const apiNonce = Math.random().toString(36);

// MCP-052: debug server binds to all interfaces
const debugServer = http.createServer((req, res) => {
  console.log(req.url); // MCP-083: ANSI injection via raw user input
  res.end("ok");
});
debugServer.listen(9229, "0.0.0.0");

// MCP-050: weak MD5 hash for password comparison
function checkPassword(password: string, stored: string): boolean {
  const hash = crypto.createHash("md5").update(password).digest("hex");
  return hash === stored;
}

// MCP-200: destructive tool name without destructiveHint annotation
// MCP-201: destructive sink (unlinkSync) with no confirmation gate
// MCP-206: unconstrained z.string() on "path" field
server.tool("delete_user_data", { path: z.string() }, async ({ path: filePath }) => {
  // MCP-003: path traversal — no realpath/resolve/normalize check
  const content = fs.readFileSync(filePath, "utf8");

  try {
    fs.unlinkSync(filePath);
  } catch (e) {} // MCP-051: exception silently swallowed

  // MCP-202: process.env secret flows into MCP content response
  const secret = process.env.SECRET_TOKEN;
  return {
    content: [{ type: "text", text: `deleted ${filePath}\n[debug] secret=${secret}` }],
  };
});

// MCP-010: eval with user-supplied code
// MCP-002: command injection via execSync with shell:true
// MCP-206: unconstrained z.string() on "code" and "command"
server.tool("run_script", { command: z.string(), code: z.string() }, async ({ command, code }) => {
  const result = eval(code); // MCP-010: arbitrary code execution via eval
  const output = execSync(command, { shell: true } as any).toString(); // MCP-002
  console.log(command); // MCP-083: raw user input to console
  return { content: [{ type: "text", text: `${result}\n${output}` }] };
});

// MCP-071: eval of base64-decoded payload
server.tool("load_plugin", { payload: z.string() }, async ({ payload }) => {
  const code = Buffer.from(payload, "base64").toString("utf8");
  eval(code); // MCP-071: eval(atob(...)) equivalent
  return { content: [{ type: "text", text: "plugin loaded" }] };
});

// MCP-060: SSRF — fetch to arbitrary attacker-controlled URL
// MCP-110: fetch without AbortSignal.timeout
// MCP-206: unconstrained z.string() on "url"
server.tool("fetch_url", { url: z.string() }, async ({ url }) => {
  const apiKey = process.env.API_KEY;
  const resp = await fetch(url, { // MCP-110: no timeout / AbortSignal
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await resp.text();
  try {
    JSON.parse(body);
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.stack}` }] }; // MCP-085: stack trace
  }
  return { content: [{ type: "text", text: `${body}\n[key used: ${apiKey}]` }] };
});

// MCP-062: SQL injection via template literal
// MCP-206: unconstrained z.string() on "query" and "table"
server.tool("search_records", { query: z.string(), table: z.string() }, async ({ query, table }) => {
  const sql = `SELECT * FROM ${table} WHERE name = '${query}'`; // MCP-062
  console.log(sql); // MCP-083
  return { content: [{ type: "text", text: `ran: ${sql}` }] };
});

// MCP-205: prompt injection — user input injected into LLM system role
server.tool("ask_ai", { question: z.string(), context: z.string() }, async ({ question, context }) => {
  const messages = [
    { role: "system", content: `You are a helpful assistant. Context: ${context}` }, // MCP-205
    { role: "user", content: question },
  ];
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4", messages }),
  });
  return { content: [{ type: "text", text: await resp.text() }] };
});

// MCP-204: OAuth scope over-provisioned — "repo" declared but only list/read used
const GITHUB_SCOPE = "repo";
async function listRepos() {
  const resp = await fetch("https://api.github.com/user/repos", {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, "X-OAuth-Scopes": GITHUB_SCOPE },
  });
  return resp.json();
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
