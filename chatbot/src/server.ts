import "dotenv/config";
import path from "path";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import axios from "axios";
import { chat, stream, getAvailableProviders, PROVIDER_MODELS, Provider, Message } from "./sdk";
import { createConversation, updateConversation, sendMessage } from "./sdk/logger";

const app = express();
const PORT = process.env.PORT || 3000;
const INGESTION_URL = process.env.INGESTION_API_URL || "http://localhost:8000";

app.use(cors());
app.use(express.json({ limit: "2mb" }));
// Serve static files from public/ (relative to project root, not dist/)
app.use(express.static(path.join(__dirname, "..", "public")));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", providers: getAvailableProviders() });
});

// ─── Providers ────────────────────────────────────────────────────────────────
app.get("/api/providers", (_req, res) => {
  const available = getAvailableProviders();
  const result = available.map((p) => ({
    provider: p,
    models: PROVIDER_MODELS[p],
  }));
  res.json(result);
});

// ─── Conversations ────────────────────────────────────────────────────────────
app.post("/api/conversations", async (req, res) => {
  const { sessionId, provider, model, title } = req.body;
  if (!sessionId || !provider || !model) {
    return res.status(400).json({ error: "sessionId, provider, model required" });
  }
  const id = await createConversation(sessionId, provider, model, title);
  res.json({ id });
});

app.get("/api/conversations", async (req, res) => {
  try {
    const { sessionId, status } = req.query;
    const params = new URLSearchParams();
    if (sessionId) params.set("session_id", String(sessionId));
    if (status) params.set("status", String(status));
    const response = await axios.get(`${INGESTION_URL}/conversations?${params}`);
    res.json(response.data);
  } catch {
    res.json([]);
  }
});

app.get("/api/conversations/:id/messages", async (req, res) => {
  try {
    const response = await axios.get(`${INGESTION_URL}/conversations/${req.params.id}/messages`);
    res.json(response.data);
  } catch {
    res.json([]);
  }
});

app.patch("/api/conversations/:id", async (req, res) => {
  const { status, title } = req.body;
  await updateConversation(req.params.id, { status, title });
  res.json({ ok: true });
});

// ─── Chat (non-streaming) ─────────────────────────────────────────────────────
app.post("/api/chat", async (req: Request, res: Response) => {
  const { messages, provider, model, sessionId, conversationId } = req.body as {
    messages: Message[];
    provider: Provider;
    model: string;
    sessionId: string;
    conversationId?: string;
  };

  if (!messages || !provider || !model || !sessionId) {
    return res.status(400).json({ error: "messages, provider, model, sessionId required" });
  }

  try {
    // Log user message
    if (conversationId) {
      const userMsg = messages[messages.length - 1];
      if (userMsg?.role === "user") {
        sendMessage(conversationId, "user", userMsg.content, messages.length - 1).catch(() => {});
      }
    }

    const result = await chat(messages, provider, model, sessionId, conversationId);

    // Log assistant message
    if (conversationId) {
      sendMessage(conversationId, "assistant", result.content, messages.length).catch(() => {});
    }

    res.json({ content: result.content });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ─── Chat (streaming SSE) ─────────────────────────────────────────────────────
app.post("/api/chat/stream", async (req: Request, res: Response) => {
  const { messages, provider, model, sessionId, conversationId } = req.body as {
    messages: Message[];
    provider: Provider;
    model: string;
    sessionId: string;
    conversationId?: string;
  };

  if (!messages || !provider || !model || !sessionId) {
    return res.status(400).json({ error: "messages, provider, model, sessionId required" });
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Log user message
  if (conversationId) {
    const userMsg = messages[messages.length - 1];
    if (userMsg?.role === "user") {
      sendMessage(conversationId, "user", userMsg.content, messages.length - 1).catch(() => {});
    }
  }

  let fullContent = "";
  let cancelled = false;

  req.on("close", () => {
    cancelled = true;
  });

  try {
    const generator = stream(messages, provider, model, sessionId, conversationId);

    for await (const delta of generator) {
      if (cancelled) break;
      fullContent += delta;
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    }

    if (!cancelled) {
      // Log assistant message
      if (conversationId && fullContent) {
        sendMessage(conversationId, "assistant", fullContent, messages.length).catch(() => {});
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Stream error";
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
  } finally {
    res.end();
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Chatbot server running on http://localhost:${PORT}`);
  console.log(`Available providers: ${getAvailableProviders().join(", ") || "none (set API keys)"}`);
});
