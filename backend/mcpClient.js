// mcpClient.js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const MCP_URL = process.env.MCP_URL || "http://localhost:8000/sse";

let clientPromise = null;

async function getClient() {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const client = new Client(
      { name: "express-api", version: "1.0.0" },
      { capabilities: {} }
    );

    const transport = new SSEClientTransport(new URL(MCP_URL));
    await client.connect(transport);

    return client;
  })();

  return clientPromise;
}

/**
 * Calls MCP tool `ask_chatgpt` and passes full chat array
 * chat format: [{role: "user"|"assistant"|"system", content: "..."}, ...]
 */
export async function callAskChatGPT(chat) {
  if (!Array.isArray(chat) || chat.length === 0) {
    throw new Error("chat must be a non-empty array");
  }

  const client = await getClient();

  // Ensure tool exists (optional but helpful error message)
  const tools = await client.listTools();
  const hasTool = tools?.tools?.some((t) => t?.name === "ask_chatgpt");
  if (!hasTool) {
    throw new Error(
      `MCP tool "ask_chatgpt" not found. Available tools: ${tools?.tools
        ?.map((t) => t?.name)
        .join(", ")}`
    );
  }

  const result = await client.callTool({
    name: "ask_chatgpt",
    arguments: { chat },
  });

  // FastMCP tool results usually come back as { content: [{ type: "text", text: "..." }] }
  const text =
    result?.content?.find((c) => c?.type === "text")?.text ??
    result?.content?.[0]?.text ??
    "";

  if (!text) {
    throw new Error("MCP returned no text content");
  }

  return text;
}
