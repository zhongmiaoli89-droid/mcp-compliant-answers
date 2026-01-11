// crewAudit.js (JS, no TS libs)
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function auditAndPolish({ question, quantifiable, draftAnswer, sources }) {
  if (!quantifiable) {
    return { ok: false, answer: "[Not answered — non-quantifiable]", sources: [] };
  }

  // You set these in .env
  // CREWAI_BASE_URL like: https://your-app.crewai.com
  // CREWAI_TOKEN is a bearer token
  const baseUrl = process.env.CREWAI_BASE_URL;
  const token = process.env.CREWAI_TOKEN;

  if (!baseUrl || !token) {
    // If CrewAI isn't configured, just return the original draft.
    return { ok: true, answer: draftAnswer, sources };
  }

  // Kick off crew
  const kickoffResp = await fetch(`${baseUrl}/kickoff`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: {
        question,
        draft_answer: draftAnswer,
        sources_json: JSON.stringify(sources || []),
      },
    }),
  });

  if (!kickoffResp.ok) {
    return { ok: true, answer: draftAnswer, sources }; // fail open
  }

  const kickoff = await kickoffResp.json();
  const taskId = kickoff.task_id;
  if (!taskId) return { ok: true, answer: draftAnswer, sources };

  // Poll status
  for (let i = 0; i < 20; i++) {
    await sleep(500);

    const statusResp = await fetch(`${baseUrl}/status/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!statusResp.ok) continue;

    const status = await statusResp.json();

    if (status.status === "completed") {
      // Your crew should return JSON like: {"answer":"...", "sources":[...]}
      const out = status.result;
      let parsed = out;
      if (typeof out === "string") {
        try { parsed = JSON.parse(out); } catch {}
      }

      if (parsed?.answer) {
        return {
          ok: true,
          answer: parsed.answer,
          sources: Array.isArray(parsed.sources) ? parsed.sources : sources,
        };
      }

      return { ok: true, answer: draftAnswer, sources };
    }

    if (status.status === "failed") {
      return { ok: true, answer: draftAnswer, sources };
    }
  }

  return { ok: true, answer: draftAnswer, sources };
}
