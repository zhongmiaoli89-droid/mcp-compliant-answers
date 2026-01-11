// agent.js
import OpenAI from "openai";
import { callAskChatGPT } from "./mcpClient.js";
import { auditAndPolish } from "./crewaudit.js";
import crypto from "crypto";

/**
 * Desired behavior:
 * - ONLY quantifiable questions are answered.
 * - For quantifiable questions:
 *    1) Try MCP (company docs)
 *    2) If MCP "not found", fall back to web
 * - Non-quantifiable questions: NEVER answered.
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function makeBlockId({ parentKey, depth, questionOriginal }) {
  const base = `${parentKey ?? "root"}|${depth}|${String(questionOriginal ?? "")}`;
  return crypto.createHash("sha1").update(base).digest("hex");
}

function extractLatestUserQuestion(chat) {
  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i]?.role === "user" && typeof chat[i]?.content === "string") {
      const q = chat[i].content.trim();
      if (q) return q;
    }
  }
  return "";
}

function stripSourcesSection(text) {
  if (!text) return "";
  // Remove "Sources:" and everything after it (case-insensitive)
  return String(text).replace(/\n\s*Sources:\s*[\s\S]*$/i, "").trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return null;
  }
}

/**
 * Determines whether MCP effectively "didn't find" the answer in its documents.
 * Update these patterns to match your Python MCP responses.
 */
function isMcpNotFound(text) {
  if (!text) return true;
  const t = text.toLowerCase();

  // Your system prompt says it will respond exactly with this when missing.
  if (t.includes("not available in our current document")) return true;

  // Other likely "not found" / missing-context patterns
  if (t.includes("company information file not found")) return true;
  if (t.includes("policy file not found")) return false; // that's not "missing answer", it's just unsanitized
  if (t.includes("no companies found in the knowledge base")) return true;

  // If MCP returns an explicit error prefix
  if (t.startsWith("error:")) return true;

  return false;
}

/**
 * Web search (SerpAPI)
 */

async function searchWeb(query, { num = 5 } = {}) {
  const apiKey = process.env.SERPAPI_API_KEY;
  const engine = process.env.SERPAPI_ENGINE || "google";
  const location = process.env.SERPAPI_LOCATION || "United States";

  if (!apiKey) {
    throw new Error(
      "SERPAPI_API_KEY is not set. Add it to your .env to enable web search."
    );
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", engine);
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("num", String(num));
  url.searchParams.set("location", location);

  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`SerpAPI error: HTTP ${resp.status} ${body}`);
  }

  const json = await resp.json();
  const organic = Array.isArray(json?.organic_results) ? json.organic_results : [];
  return organic.slice(0, num).map((r) => ({
    title: r?.title || "",
    link: r?.link || "",
    snippet: r?.snippet || "",
  }));
}

/**
 * Answer using ONLY the provided web snippets.
 */
async function answerFromWeb(question) {
  const results = await searchWeb(question, { num: 5 });

  if (!results.length) {
    return { ok: false, text: "No web results found.", sources: [] };
  }

  const context = results
    .map(
      (r, i) =>
        `Source ${i + 1}\nTitle: ${r.title}\nURL: ${r.link}\nSnippet: ${r.snippet}\n`
    )
    .join("\n");

  const system = `
You are a research assistant.
Answer the user's question using ONLY the provided web snippets.
If the snippets do not contain the answer, say "Not enough information in the retrieved snippets."
Keep it concise. Then provide a "Sources:" list with the URLs you used.

Return PLAIN TEXT.
`.trim();

  const user = `
Question: ${question}

Web snippets:
${context}
`.trim();

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const text = resp.choices?.[0]?.message?.content?.trim() || "";
  const sources = results.filter((r) => r.link).map((r) => r.link);

  return { ok: true, text, sources };
}

/**
 * Decomposition
 */
async function decomposeToTree(originalQuestion) {
  if (!originalQuestion) {
    return {
      question: "No question provided.",
      quantifiable: false,
      why_quantifiable: "empty input",
      children: [],
    };
  }

  const system = `
You are an analyst agent that decomposes a user's question into a tree of smaller questions.

Rules:
- Output ONLY valid JSON (no markdown, no comments).
- Every node.question MUST be a fully standalone question (no pronouns like "it/they/this").
- Prefer quantifiable, checkable, concrete questions.
- Mark node.quantifiable=true ONLY if the question is answerable with concrete facts from a company knowledge base.
- node.children should expand the parent question into more specific subquestions.
- Do NOT answer the questions. Only decompose.

Return JSON object with shape:
{
  "question": "<original question rephrased as standalone if needed>",
  "quantifiable": false,
  "why_quantifiable": "<brief>",
  "children": [ ... ]
}
`.trim();

  const user = `Decompose this user question:\n"${originalQuestion}"`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const text = resp.choices?.[0]?.message?.content ?? "";
  const parsed = safeJsonParse(text);

  if (!parsed || typeof parsed !== "object") {
    return {
      question: originalQuestion,
      quantifiable: false,
      why_quantifiable: "Failed to parse decomposition JSON.",
      children: [],
    };
  }

  parsed.children = Array.isArray(parsed.children) ? parsed.children : [];
  return parsed;
}

async function detectFollowups(chat, tree) {
  // Use the last user question + tree to detect missing obvious info
  const originalQuestion = extractLatestUserQuestion(chat);

  const system = `
You decide if we must ask follow-up questions BEFORE answering.

We are answering questions about companies and internal docs.
Sometimes the user question is underspecified.

Return ONLY valid JSON:
{
  "needs_followup": boolean,
  "followups": [
    { "question": string, "why": string }
  ]
}

Rules:
- Ask follow-ups ONLY if they are truly needed to proceed (missing company name, ambiguous entity, missing timeframe, missing metric definition, missing geography, missing product version, unclear target).
- Keep it short: 1 to 5 questions max.
- Do NOT ask follow-ups that are just "nice to have".
- If the chat already contains the needed info, do NOT ask.
- Focus on obvious blockers.
`.trim();

  const user = `
Chat so far (most recent last):
${chat
  .slice(-12)
  .map((m) => `${String(m.role).toUpperCase()}: ${String(m.content || "")}`)
  .join("\n")}

User's latest question:
${originalQuestion}

Decomposition tree (JSON):
${JSON.stringify(tree)}
`.trim();

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const text = resp.choices?.[0]?.message?.content ?? "";
  const parsed = safeJsonParse(text);

  if (!parsed || typeof parsed !== "object") {
    // If parsing fails, don't block answering
    return { needs_followup: false, followups: [] };
  }

  const needs = Boolean(parsed.needs_followup);
  const followups = Array.isArray(parsed.followups) ? parsed.followups : [];

  // Normalize
  const clean = followups
    .map((f) => ({
      question: String(f?.question ?? "").trim(),
      why: String(f?.why ?? "").trim(),
    }))
    .filter((f) => f.question.length > 0)
    .slice(0, 5);

  return { needs_followup: needs && clean.length > 0, followups: clean };
}

async function isQuantifiable(question) {
  const system = `
You are a classifier.

Return ONLY valid JSON:
{
  "quantifiable": boolean,
  "why": string
}

A question is quantifiable if it can be answered with concrete, factual data
(definitions, lists, metrics, comparisons, yes/no facts).

Do NOT consider opinions or vague explanations quantifiable.
`.trim();

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: question },
    ],
  });

  const parsed = safeJsonParse(resp.choices?.[0]?.message?.content ?? "");
  return parsed?.quantifiable === true;
}

async function decomposeToQuantifiable(question) {
  const system = `
Break the following question into an appropriate number (2–6)
of fully standalone, quantifiable questions.

Rules:
- Output ONLY a JSON array of strings.
- Each question must be answerable with concrete facts.
- No opinions, no vague wording.
- Do NOT answer the questions.
`.trim();

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: question },
    ],
  });

  const parsed = safeJsonParse(resp.choices?.[0]?.message?.content ?? "");
  return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
}

async function detectFollowupsFromAnswer(question, answer) {
  const system = `
You are an analyst.

Given a question and its answer, decide whether there are
obvious, necessary follow-up questions to fully understand the topic.

Return ONLY valid JSON:
{
  "followups": [string]
}

Rules:
- Followups must be quantifiable.
- Max 3 followups.
- If none are needed, return an empty array.
`.trim();

  const user = `
Question:
${question}

Answer:
${answer}
`.trim();

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const parsed = safeJsonParse(resp.choices?.[0]?.message?.content ?? "");
  return Array.isArray(parsed?.followups) ? parsed.followups : [];
}

export async function answerWithAgent(chat) {
  const initialQuestion = extractLatestUserQuestion(chat);
  if (!initialQuestion) return { ok: false, error: "No user question found." };

  const MAX_DEPTH = 1;

  const normalize = (s) =>
    String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

  // key -> entry
  const answered = new Map();

  // parentKey -> [{ key, questionOriginal }]
  const children = new Map();

  const seen = new Set();
  let totalGenerated = 1;

  const addChild = (parentKey, childKey, childOriginal) => {
    if (!parentKey) return;
    if (!children.has(parentKey)) children.set(parentKey, []);
    const arr = children.get(parentKey);
    if (!arr.some((x) => x.key === childKey)) {
      arr.push({ key: childKey, questionOriginal: childOriginal });
    }
  };

  // A "node" in our working set
  // { questionOriginal, parentOriginal, depth }
  let pocket = [
    { questionOriginal: initialQuestion.trim(), parentOriginal: null, depth: 0 },
  ];

  while (pocket.length > 0) {
    // Filter out duplicates early, but still record edges
    const uniquePocket = [];
    for (const node of pocket) {
      const q = String(node.questionOriginal || "").trim();
      if (!q) continue;

      const qKey = normalize(q);
      const parentOriginal = node.parentOriginal
        ? String(node.parentOriginal).trim()
        : null;
      const parentKey = parentOriginal ? normalize(parentOriginal) : null;

      // Track edge even if we later skip answering due to duplication
      if (parentKey) addChild(parentKey, qKey, q);

      if (seen.has(qKey)) continue;
      seen.add(qKey);

      uniquePocket.push({ questionOriginal: q, parentOriginal, depth: node.depth });
    }

    if (uniquePocket.length === 0) break;

    // Answer all in this pocket simultaneously
    const results = await Promise.all(
      uniquePocket.map(async ({ questionOriginal: qOriginal, parentOriginal, depth }) => {
        const qKey = normalize(qOriginal);
        const parentKey = parentOriginal ? normalize(parentOriginal) : null;

        // 1) classify
        const quantifiable = await isQuantifiable(qOriginal);

        if (!quantifiable) {
          // Record but do not answer
          answered.set(qKey, {
            questionOriginal: qOriginal,
            quantifiable: false,
            answer: "[Not answered — non-quantifiable]",
            source: null,
            sources: [],
            parentOriginal,
            parentKey,
          });

          // Expand via decomposition (if allowed)
          let nextNodes = [];
          if (depth < MAX_DEPTH) {
            const subs = await decomposeToQuantifiable(qOriginal);
            nextNodes = subs
              .map((sq) => String(sq || "").trim())
              .filter(Boolean)
              .map((sqOriginal) => {
                totalGenerated++;
                return {
                  questionOriginal: sqOriginal,
                  parentOriginal: qOriginal,
                  depth: depth + 1,
                };
              });
          }

          return { qOriginal, nextNodes };
        }

        // 2) Answer quantifiable (MCP -> web fallback)
        let answerText = "";
        let source = "mcp";
        let sources = [];

        try {
          const mcpAnswer = await callAskChatGPT([
            { role: "user", content: qOriginal },
          ]);
          if (!isMcpNotFound(mcpAnswer)) {
            answerText = String(mcpAnswer || "").trim();
          } else {
            throw new Error("MCP not found");
          }
        } catch {
          const web = await answerFromWeb(qOriginal);
          answerText = web.ok ? stripSourcesSection(web.text) : "No data found.";
          source = "web";
          sources = web.sources || [];
        }

        answered.set(qKey, {
          questionOriginal: qOriginal,
          quantifiable: true,
          answer: answerText,
          source,
          sources,
          parentOriginal,
          parentKey,
        });

        // 3) Expand via followups (if allowed)
        let nextNodes = [];
        if (depth < MAX_DEPTH) {
          const followups = await detectFollowupsFromAnswer(qOriginal, answerText);
          nextNodes = (followups || [])
            .map((f) => String(f || "").trim())
            .filter(Boolean)
            .map((fOriginal) => {
              totalGenerated++;
              return {
                questionOriginal: fOriginal,
                parentOriginal: qOriginal,
                depth: depth + 1,
              };
            });
        }

        return { qOriginal, nextNodes };
      })
    );

    // Build next pocket from all expansions (simultaneously generated)
    pocket = results.flatMap((r) => r.nextNodes || []);
  }

  // Render tree starting from root
  function render(qOriginal, indent = 0) {
    const qKey = normalize(qOriginal);
    const pad = "  ".repeat(indent);

    const entry = answered.get(qKey);

    let out = `${pad}- Q: ${qOriginal}\n`;

    if (entry) {
      out += `${pad}  Quantifiable: ${entry.quantifiable ? "yes" : "no"}\n`;
      out += `${pad}  A: ${entry.answer}\n`;
      if (entry.source) out += `${pad}  Source: ${entry.source}\n`;
    } else {
      out += `${pad}  Quantifiable: unknown\n`;
      out += `${pad}  A: [No entry generated]\n`;
    }

    const kids = children.get(qKey) || [];
    for (const k of kids) out += render(k.questionOriginal, indent + 1);
    return out;
  }

  const blocks = Array.from(answered.values()).map((x, i) => ({
    id: String(i),
    question: x.questionOriginal,
    answer: x.answer,
    sources: Array.isArray(x.sources) ? x.sources : [],
  }));

  return {
    ok: true,
    blocks,
    rendered: render(initialQuestion.trim(), 0), // optional: handy for debugging
    stats: {
      questionsAnswered: blocks.length,
      totalGenerated,
      totalSeen: answered.size,
    },
  };
}
