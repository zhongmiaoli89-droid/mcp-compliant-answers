import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

let clientPromise = null;

async function connect(urlString) {
  const transport = new StreamableHTTPClientTransport(new URL(urlString));
  const client = new Client(
    { name: "express-mcp-client", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(transport);

  // Optional: verify tool exists
  const tools = await client.request({ method: "tools/list" }, ListToolsResultSchema);
  const toolNames = tools.tools.map((t) => t.name);
  if (!toolNames.includes("ask_chatgpt")) {
    throw new Error(`Connected, but "ask_chatgpt" not found. Tools: ${toolNames.join(", ")}`);
  }

  return client;
}

async function getClient() {
  if (clientPromise) return clientPromise;

  // Most Streamable HTTP servers mount at /mcp
  const base = process.env.MCP_URL || "http://127.0.0.1:8000/mcp";

  clientPromise = connect(base);
  return clientPromise;
}

export async function callAskChatGPT(question) {
  const client = await getClient();

  const result = await client.request(
    {
      method: "tools/call",
      params: { name: "ask_chatgpt", arguments: { question } },
    },
    CallToolResultSchema
  );

  const textParts =
    result?.content
      ?.map((c) => (typeof c?.text === "string" ? c.text : ""))
      .filter(Boolean) ?? [];

  return textParts.join("\n").trim() || "(No text content returned)";
}
