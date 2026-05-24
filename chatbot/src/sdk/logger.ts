/**
 * SDK Logger — sends inference metadata to the ingestion API.
 * Fire-and-forget with retry logic.
 */
import axios from "axios";
import { InferenceMetadata } from "./types";

const INGESTION_URL = process.env.INGESTION_API_URL || "http://localhost:8000";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendLog(metadata: InferenceMetadata): Promise<void> {
  const payload = {
    conversation_id: metadata.conversationId,
    session_id: metadata.sessionId,
    provider: metadata.provider,
    model: metadata.model,
    request_timestamp: metadata.requestTimestamp.toISOString(),
    response_timestamp: metadata.responseTimestamp?.toISOString(),
    latency_ms: metadata.latencyMs,
    prompt_tokens: metadata.promptTokens,
    completion_tokens: metadata.completionTokens,
    total_tokens: metadata.totalTokens,
    status: metadata.status,
    error_code: metadata.errorCode,
    error_message: metadata.errorMessage,
    http_status_code: metadata.httpStatusCode,
    input_text: metadata.inputText,
    output_text: metadata.outputText,
    is_streaming: metadata.isStreaming,
    stream_chunks: metadata.streamChunks,
    time_to_first_token_ms: metadata.timeToFirstTokenMs,
    request_metadata: metadata.requestMetadata || {},
    response_metadata: metadata.responseMetadata || {},
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await axios.post(`${INGESTION_URL}/ingest/logs`, payload, {
        timeout: 5000,
        headers: { "Content-Type": "application/json" },
      });
      return;
    } catch (err: unknown) {
      const isLast = attempt === MAX_RETRIES;
      if (isLast) {
        // Log to stderr but don't crash the app
        console.error(`[SDK] Failed to send log after ${MAX_RETRIES} attempts:`, err instanceof Error ? err.message : err);
      } else {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
}

export async function sendMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
  sequenceNum: number
): Promise<void> {
  try {
    await axios.post(
      `${INGESTION_URL}/ingest/messages`,
      {
        conversation_id: conversationId,
        role,
        content,
        sequence_num: sequenceNum,
      },
      { timeout: 5000 }
    );
  } catch (err) {
    console.error("[SDK] Failed to send message:", err instanceof Error ? err.message : err);
  }
}

export async function createConversation(
  sessionId: string,
  provider: string,
  model: string,
  title?: string
): Promise<string | null> {
  try {
    const res = await axios.post(
      `${INGESTION_URL}/ingest/conversations`,
      { session_id: sessionId, provider, model, title },
      { timeout: 5000 }
    );
    return res.data.id as string;
  } catch (err) {
    console.error("[SDK] Failed to create conversation:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function updateConversation(
  conversationId: string,
  update: { status?: string; title?: string }
): Promise<void> {
  try {
    await axios.patch(
      `${INGESTION_URL}/ingest/conversations/${conversationId}`,
      update,
      { timeout: 5000 }
    );
  } catch (err) {
    console.error("[SDK] Failed to update conversation:", err instanceof Error ? err.message : err);
  }
}
