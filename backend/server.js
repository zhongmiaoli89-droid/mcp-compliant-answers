import express from "express";
import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import { answerWithAgent} from "./agent.js";


dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Helper: parse chat input the same way you do today
function parseChat(req) {
  const { message, messages } = req.body ?? {};
  let chat = null;

  if (Array.isArray(messages) && messages.length > 0) {
    chat = messages
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant" || m.role === "system") &&
          typeof m.content === "string" &&
          m.content.trim().length > 0
      )
      .map((m) => ({ role: m.role, content: m.content.trim() }));
  } else if (typeof message === "string" && message.trim().length > 0) {
    chat = [{ role: "user", content: message.trim() }];
  }

  return chat && chat.length > 0 ? chat : null;
}

app.post("/api/chat", async (req, res) => {
  const chat = parseChat(req);
  if (!chat) {
    return res.status(400).json({ ok: false, error: "Message(s) are required." });
  }




  // --- NON-STREAM MODE (your existing behavior) ---
  try {
    const result = await answerWithAgent(chat);

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    return res.json({
      ok: true,
      blocks: result.blocks,
      diagram: result.diagram ?? null,   // ✅ add this
      stats: result.stats,
      id: crypto.randomUUID?.() ?? String(Date.now()),
    });
  } catch (err) {
    console.error("Agent/MCP error:", err);
    return res.status(502).json({
      ok: false,
      error: err?.message || "Agent/MCP request failed.",
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
