import { useEffect, useMemo, useRef, useState } from "react";

const BAD_ANSWER_STRINGS = new Set([
  "Not enough information in the retrieved snippets.",
  "[Not answered — non-quantifiable]",
]);

function isBadAnswerText(answer) {
  if (typeof answer !== "string") return false;
  return BAD_ANSWER_STRINGS.has(answer.trim());
}

function stripSanitizedPrefix(text) {
  if (typeof text !== "string") return "";
  const t = text;

  const trimmedStart = t.replace(/^\s+/, "");
  const prefix = "### SANITIZED ANSWER:";
  if (!trimmedStart.startsWith(prefix)) return t;

  let rest = trimmedStart.slice(prefix.length);
  rest = rest.replace(/^\s*/, "");
  rest = rest.replace(/^\n+/, "").replace(/^\s+/, "");
  return rest;
}

function filterGoodBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map((b) => {
      const raw = b?.answer;
      const cleaned = stripSanitizedPrefix(typeof raw === "string" ? raw : "");
      return { ...b, answer: cleaned };
    })
    .filter((b) => {
      const ans = b?.answer;
      if (typeof ans !== "string") return false;
      if (!ans.trim()) return false;
      if (isBadAnswerText(ans)) return false;
      return true;
    });
}

function buildPayloadMessagesFromTurns(turns, newUserText) {
  const msgs = [];
  for (const t of turns) {
    msgs.push({ role: "user", content: t.userText });

    const goodBlocks = filterGoodBlocks(t.blocks);
    const answers = goodBlocks
      .map((b) => (typeof b?.answer === "string" ? b.answer : ""))
      .filter(Boolean)
      .join("\n\n");

    if (answers.trim()) {
      msgs.push({ role: "assistant", content: answers });
    }
  }
  msgs.push({ role: "user", content: newUserText });
  return msgs;
}

/**
 * Super-light renderer for diagram payloads.
 * For now:
 * - Mermaid: show code (later you can render)
 * - Vega-Lite: show spec + data (later you can render with vega-embed)
 */
function DiagramPane({ diagram }) {
  if (!diagram) {
    return (
      <div style={styles.rightEmpty}>
        <div style={styles.rightEmptyTitle}>Diagrams</div>
        <div style={styles.rightEmptyText}>No diagram for this turn.</div>
      </div>
    );
  }

  const should = Boolean(diagram?.should_diagram);
  if (!should) {
    return (
      <div style={styles.rightEmpty}>
        <div style={styles.rightEmptyTitle}>Diagrams</div>
        <div style={styles.rightEmptyText}>
          Diagram not recommended{diagram?.why ? `: ${diagram.why}` : "."}
        </div>
      </div>
    );
  }

  const type = String(diagram?.type || "").toLowerCase();

  return (
    <div style={styles.diagramCard}>
      <div style={styles.diagramHeader}>
        <div style={styles.diagramTitle}>
          {diagram?.title ? String(diagram.title) : "Diagram"}
        </div>
        <div style={styles.diagramMeta}>
          Type: <strong>{type}</strong>
        </div>
      </div>

      {diagram?.why ? (
        <div style={styles.diagramWhy}>{String(diagram.why)}</div>
      ) : null}

      {type === "mermaid" ? (
        <div style={styles.diagramBlock}>
          <div style={styles.diagramLabel}>Mermaid</div>
          <pre style={styles.pre}>
            {String(diagram?.mermaid || "") || "[No mermaid content]"}
          </pre>
          <div style={styles.diagramHint}>
            (Later: render this with mermaid.js in the browser or via MCP→SVG.)
          </div>
        </div>
      ) : type === "vega_lite" ? (
        <div style={styles.diagramBlock}>
          <div style={styles.diagramLabel}>Vega-Lite spec</div>
          <pre style={styles.pre}>
            {JSON.stringify(diagram?.spec ?? {}, null, 2)}
          </pre>

          <div style={{ height: 10 }} />

          <div style={styles.diagramLabel}>Data</div>
          <pre style={styles.pre}>
            {JSON.stringify(diagram?.data ?? [], null, 2)}
          </pre>
          <div style={styles.diagramHint}>
            (Later: render this with vega-embed using spec+data.)
          </div>
        </div>
      ) : (
        <div style={styles.diagramBlock}>
          <div style={styles.diagramLabel}>Diagram payload</div>
          <pre style={styles.pre}>{JSON.stringify(diagram, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default function ChatUI() {
  const [error, setError] = useState("");

  const [chats, setChats] = useState(() => [
    { id: "chat-1", title: "Chat 1", turns: [], draft: "", sending: false },
  ]);
  const [activeChatId, setActiveChatId] = useState("chat-1");

  const endRef = useRef(null);

  const chatsRef = useRef(chats);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  const abortersRef = useRef(new Map()); // chatId -> AbortController

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId),
    [chats, activeChatId]
  );

  // Show diagram for the latest turn in the active chat (or null)
  const activeDiagram = useMemo(() => {
    const turns = activeChat?.turns || [];
    if (!turns.length) return null;
    return turns[turns.length - 1]?.diagram ?? null;
  }, [activeChat?.turns]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.turns?.length]);

  useEffect(() => {
    if (!activeChat && chats.length > 0) setActiveChatId(chats[0].id);
  }, [activeChat, chats]);

  function createNewChat() {
    const nextIndex = chatsRef.current.length + 1;
    const newChat = {
      id: crypto.randomUUID(),
      title: `Chat ${nextIndex}`,
      turns: [],
      draft: "",
      sending: false,
    };
    setChats((prev) => [...prev, newChat]);
    setActiveChatId(newChat.id);
    setError("");
  }

  function renameChat(chatId, title) {
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, title } : c))
    );
  }

  function setDraft(chatId, draft) {
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, draft } : c))
    );
  }

  async function sendMessage(chatId = activeChatId) {
    const chat = chatsRef.current.find((c) => c.id === chatId);
    if (!chat) return;

    const text = (chat.draft || "").trim();
    if (!text) return;

    if (chat.sending) return;

    setError("");

    const prevAbort = abortersRef.current.get(chatId);
    if (prevAbort) prevAbort.abort();
    const controller = new AbortController();
    abortersRef.current.set(chatId, controller);

    const turnId = `t-${crypto.randomUUID()}`;

    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== chatId) return c;
        return {
          ...c,
          sending: true,
          draft: "",
          turns: [
            ...c.turns,
            {
              id: turnId,
              userText: text,
              blocks: [
                {
                  id: `pending-${turnId}`,
                  question: "Thinking...",
                  answer: "",
                  sources: [],
                  pending: true,
                },
              ],
              diagram: null, // ✅ reserve slot
            },
          ],
        };
      })
    );

    const payloadMessages = buildPayloadMessagesFromTurns(chat.turns, text);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ messages: payloadMessages }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const maybe = await res.json().catch(() => null);
        throw new Error(maybe?.error || `Request failed (${res.status})`);
      }

      const data = await res.json().catch(() => null);
      if (!data?.ok) {
        throw new Error(data?.error || "Server returned an error.");
      }

      const blocks = Array.isArray(data.blocks) ? data.blocks : [];
      const diagram = data.diagram ?? null; // ✅ read diagram

      const cleanedBlocks = blocks.map((b, i) => {
        const raw = typeof b?.answer === "string" ? b.answer : "";
        return {
          id: b?.id ?? String(i),
          question: b?.question ?? `Q${i + 1}`,
          answer: stripSanitizedPrefix(raw),
          sources: Array.isArray(b?.sources) ? b.sources : [],
        };
      });

      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== chatId) return c;
          return {
            ...c,
            sending: false,
            turns: c.turns.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    blocks: cleanedBlocks.length
                      ? cleanedBlocks
                      : [
                          {
                            id: `empty-${turnId}`,
                            question: "No result",
                            answer: "No blocks returned.",
                            sources: [],
                          },
                        ],
                    diagram, // ✅ store diagram in the turn
                  }
                : t
            ),
          };
        })
      );
    } catch (e) {
      if (e?.name === "AbortError") {
        setChats((prev) =>
          prev.map((c) => (c.id === chatId ? { ...c, sending: false } : c))
        );
        return;
      }

      const msg = e?.message || "Something went wrong sending the message.";
      setError(msg);

      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== chatId) return c;
          return {
            ...c,
            sending: false,
            turns: c.turns.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    blocks: [
                      {
                        id: `err-${turnId}`,
                        question: "Error",
                        answer: msg,
                        sources: [],
                      },
                    ],
                    diagram: null,
                  }
                : t
            ),
          };
        })
      );
    } finally {
      const current = abortersRef.current.get(chatId);
      if (current === controller) abortersRef.current.delete(chatId);
    }
  }

  function onKeyDown(e) {
    if (e.isComposing) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(activeChatId);
    }
  }

  function QAItem({ block }) {
    const [open, setOpen] = useState(false);
    const hasSources = Array.isArray(block.sources) && block.sources.length > 0;

    const raw = typeof block.answer === "string" ? block.answer : "";
    const answer = stripSanitizedPrefix(raw);
    const hasAnswer = answer.trim().length > 0 && !isBadAnswerText(answer);

    if (!hasAnswer && !block.pending) return null;

    return (
      <div style={styles.qaCard}>
        <div style={styles.qaQuestion}>
          <strong>{block.question}</strong>
        </div>

        <div style={styles.qaAnswer}>{answer}</div>

        {hasSources ? (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setOpen((v) => !v)} style={styles.sourcesBtn}>
              {open ? "Hide sources" : "Show sources"}
            </button>

            {open ? (
              <div style={styles.sourcesBox}>
                {block.sources.map((s) => (
                  <div key={s} style={styles.sourceRow}>
                    <a
                      href={s}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.sourceLink}
                    >
                      {s}
                    </a>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function Turn({ turn }) {
    return (
      <div style={styles.turn}>
        <div style={{ ...styles.bubbleRow, justifyContent: "flex-end" }}>
          <div style={{ ...styles.bubble, ...styles.userBubble }}>
            {turn.userText}
          </div>
        </div>

        <div style={{ ...styles.bubbleRow, justifyContent: "flex-start" }}>
          <div style={{ ...styles.bubble, ...styles.serverBubble }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {turn.blocks.map((b) => (
                <QAItem key={b.id || `${turn.id}-${b.question}`} block={b} />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const draft = activeChat?.draft ?? "";
  const sending = activeChat?.sending ?? false;

  return (
    <div style={styles.page}>
      <div style={styles.split}>
        {/* LEFT HALF */}
        <div style={styles.leftPane}>
          <div style={styles.card}>
            <div style={styles.tabsBar}>
              <div style={styles.tabsScroll}>
                {chats.map((c) => {
                  const active = c.id === activeChatId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveChatId(c.id)}
                      style={{ ...styles.tab, ...(active ? styles.tabActive : null) }}
                      title="Click to switch. Double-click to rename."
                      onDoubleClick={() => {
                        const name = prompt("Rename chat:", c.title);
                        if (typeof name === "string" && name.trim()) {
                          renameChat(c.id, name.trim());
                        }
                      }}
                    >
                      {c.title}
                    </button>
                  );
                })}
              </div>

              <button onClick={createNewChat} style={styles.newChatBtn}>
                + New
              </button>
            </div>

            <div style={styles.header}>
              <div style={styles.title}>Chat - Current depth: 2</div>
            </div>

            <div style={styles.inputRow}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(activeChatId, e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={sending ? "Sending..." : "Type a message..."}
                disabled={sending}
                style={styles.textarea}
                rows={2}
              />
              <button
                onClick={() => sendMessage(activeChatId)}
                disabled={sending || draft.trim().length === 0}
                style={{
                  ...styles.button,
                  opacity: sending || draft.trim().length === 0 ? 0.6 : 1,
                }}
              >
                Send
              </button>
            </div>

            <div style={styles.chatArea}>
              {activeChat?.turns?.length ? (
                activeChat.turns.map((t) => <Turn key={t.id} turn={t} />)
              ) : (
                <div style={styles.empty}>Send a message to begin.</div>
              )}
              <div ref={endRef} />
            </div>

            {error ? <div style={styles.error}>{error}</div> : null}
          </div>
        </div>

        {/* RIGHT HALF: diagrams */}
        <div style={styles.rightPane}>
          <div style={styles.rightCard}>
            <DiagramPane diagram={activeDiagram} />
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    padding: 16,
    background: "#f8f9fa",
    color: "#202124",
    fontFamily:
      'Roboto, ui-sans-serif, system-ui, -apple-system, Segoe UI, "Helvetica Neue", Arial',
  },

  split: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    width: "calc(100vw - 32px)",
    height: "calc(100vh - 32px)",
  },

  leftPane: { width: "100%", height: "100%", minWidth: 0 },
  rightPane: { width: "100%", height: "100%", minWidth: 0 },

  card: {
    width: "min(720px, 100%)",
    maxHeight: "90vh",
    height: "90vh",
    background: "#ffffff",
    border: "1px solid #dadce0",
    borderRadius: 16,
    boxShadow: "0 2px 10px rgba(60,64,67,0.15)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    marginTop: 50,
  },

  // Right side card mirrors left card sizing
  rightCard: {
    width: "min(720px, 100%)",
    maxHeight: "90vh",
    height: "90vh",
    background: "#ffffff",
    border: "1px solid #dadce0",
    borderRadius: 16,
    boxShadow: "0 2px 10px rgba(60,64,67,0.15)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    marginTop: 50,
    padding: 16,
  },

  tabsBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderBottom: "1px solid #e0e3e7",
    background: "#ffffff",
  },
  tabsScroll: {
    display: "flex",
    gap: 8,
    overflowX: "auto",
    flex: 1,
    paddingBottom: 2,
    minWidth: 0,
  },

  tab: {
    borderRadius: 999,
    border: "1px solid #dadce0",
    background: "#ffffff",
    color: "#3c4043",
    padding: "6px 10px",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontSize: 12,
  },
  tabActive: {
    border: "1px solid #1a73e8",
    background: "rgba(26,115,232,0.08)",
    color: "#1a73e8",
  },

  newChatBtn: {
    borderRadius: 12,
    border: "1px solid #1a73e8",
    background: "#1a73e8",
    color: "#ffffff",
    padding: "8px 10px",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 12,
  },

  header: {
    padding: "16px 16px 12px",
    borderBottom: "1px solid #e0e3e7",
    background: "#ffffff",
  },
  title: { fontSize: 18, fontWeight: 700, color: "#202124" },

  chatArea: {
    flex: 1,
    padding: 16,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    background: "#ffffff",
  },

  empty: {
    opacity: 0.8,
    border: "1px dashed #dadce0",
    borderRadius: 12,
    padding: 16,
    alignSelf: "center",
    marginTop: 20,
    color: "#5f6368",
    background: "#f8f9fa",
  },

  turn: { display: "flex", flexDirection: "column", gap: 8 },

  bubbleRow: { display: "flex" },
  bubble: {
    maxWidth: "88%",
    padding: "10px 12px",
    borderRadius: 14,
    whiteSpace: "pre-wrap",
    lineHeight: 1.35,
    wordBreak: "break-word",
    boxShadow: "0 1px 2px rgba(60,64,67,0.10)",
  },

  userBubble: {
    background: "rgba(26,115,232,0.10)",
    border: "1px solid rgba(26,115,232,0.22)",
    color: "#174ea6",
  },

  serverBubble: {
    background: "#f1f3f4",
    border: "1px solid #e0e3e7",
    color: "#202124",
  },

  error: {
    margin: "10px 16px 16px",
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(217,48,37,0.10)",
    border: "1px solid rgba(217,48,37,0.25)",
    color: "#d93025",
    fontSize: 13,
  },

  inputRow: {
    display: "flex",
    gap: 10,
    padding: 16,
    borderBottom: "1px solid #e0e3e7",
    background: "#ffffff",
    position: "sticky",
    top: 0,
    zIndex: 5,
    backdropFilter: "blur(8px)",
  },

  textarea: {
    flex: 1,
    resize: "none",
    borderRadius: 12,
    border: "1px solid #dadce0",
    background: "#ffffff",
    color: "#202124",
    padding: 12,
    outline: "none",
    fontSize: 14,
    minHeight: 44,
    boxShadow: "inset 0 1px 1px rgba(60,64,67,0.06)",
  },

  button: {
    borderRadius: 12,
    border: "1px solid #1a73e8",
    background: "#1a73e8",
    color: "#ffffff",
    padding: "0 14px",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 1px 2px rgba(26,115,232,0.25)",
  },

  qaCard: {
    border: "1px solid #e0e3e7",
    background: "#ffffff",
    borderRadius: 12,
    padding: 12,
    boxShadow: "0 1px 2px rgba(60,64,67,0.10)",
  },
  qaQuestion: { marginBottom: 6, color: "#202124" },
  qaAnswer: { whiteSpace: "pre-wrap", lineHeight: 1.35, color: "#3c4043" },

  sourcesBtn: {
    borderRadius: 10,
    border: "1px solid #dadce0",
    background: "#f8f9fa",
    color: "#1a73e8",
    padding: "6px 10px",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 12,
  },
  sourcesBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    background: "#f8f9fa",
    border: "1px solid #e0e3e7",
  },
  sourceRow: { marginBottom: 6 },
  sourceLink: { color: "#1a73e8", wordBreak: "break-word" },

  // Right pane styles
  rightEmpty: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    justifyContent: "center",
    alignItems: "center",
    textAlign: "center",
    color: "#5f6368",
    background: "#ffffff",
  },
  rightEmptyTitle: { fontSize: 18, fontWeight: 800, color: "#202124" },
  rightEmptyText: { fontSize: 13, maxWidth: 380 },

  diagramCard: {
    border: "1px solid #e0e3e7",
    background: "#ffffff",
    borderRadius: 16,
    padding: 14,
    boxShadow: "0 1px 2px rgba(60,64,67,0.10)",
    height: "100%",
    overflow: "auto",
  },
  diagramHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
    paddingBottom: 8,
    borderBottom: "1px solid #e0e3e7",
    marginBottom: 10,
  },
  diagramTitle: { fontSize: 16, fontWeight: 800, color: "#202124" },
  diagramMeta: { fontSize: 12, color: "#5f6368" },
  diagramWhy: {
    fontSize: 13,
    color: "#3c4043",
    marginBottom: 10,
  },
  diagramBlock: { marginTop: 10 },
  diagramLabel: { fontSize: 12, fontWeight: 800, color: "#202124", marginBottom: 6 },
  diagramHint: { fontSize: 12, color: "#5f6368", marginTop: 6 },
  pre: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    background: "#f8f9fa",
    border: "1px solid #e0e3e7",
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
    lineHeight: 1.35,
  },
};
