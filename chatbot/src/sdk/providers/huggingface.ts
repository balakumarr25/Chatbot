/**
 * HuggingFace Serverless Inference API provider.
 * Uses axios directly (avoids OpenAI SDK DNS issues in Docker).
 * Endpoint: https://router.huggingface.co/v1/chat/completions
 */
import axios from "axios";
import { Message, InferenceMetadata, Provider } from "../types";
import { sendLog } from "../logger";

const BASE_URL = "https://router.huggingface.co/v1/chat/completions";

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY || ""}`,
    "Content-Type": "application/json",
  };
}

export async function chatHuggingFace(
  messages: Message[],
  model: string,
  sessionId: string,
  conversationId?: string
): Promise<{ content: string; metadata: InferenceMetadata }> {
  const requestTimestamp = new Date();

  const metadata: InferenceMetadata = {
    sessionId,
    conversationId,
    provider: "huggingface" as Provider,
    model,
    requestTimestamp,
    status: "success",
    isStreaming: false,
    inputText: messages[messages.length - 1]?.content,
  };

  try {
    const response = await axios.post(
      BASE_URL,
      {
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: 1024,
        stream: false,
      },
      { headers: getHeaders(), timeout: 60000 }
    );

    const responseTimestamp = new Date();
    const content = response.data.choices?.[0]?.message?.content || "";

    metadata.responseTimestamp = responseTimestamp;
    metadata.latencyMs = responseTimestamp.getTime() - requestTimestamp.getTime();
    metadata.promptTokens = response.data.usage?.prompt_tokens;
    metadata.completionTokens = response.data.usage?.completion_tokens;
    metadata.totalTokens = response.data.usage?.total_tokens;
    metadata.outputText = content;

    sendLog(metadata).catch(() => {});
    return { content, metadata };
  } catch (err: unknown) {
    metadata.status = "error";
    metadata.responseTimestamp = new Date();
    metadata.latencyMs = metadata.responseTimestamp.getTime() - requestTimestamp.getTime();
    if (axios.isAxiosError(err)) {
      metadata.errorCode = String(err.response?.status || "");
      metadata.errorMessage = err.response?.data?.error?.message || err.message;
      metadata.httpStatusCode = err.response?.status;
    } else if (err instanceof Error) {
      metadata.errorMessage = err.message;
    }
    sendLog(metadata).catch(() => {});
    throw new Error(metadata.errorMessage || "HuggingFace request failed");
  }
}

export async function* streamHuggingFace(
  messages: Message[],
  model: string,
  sessionId: string,
  conversationId?: string
): AsyncGenerator<string> {
  const requestTimestamp = new Date();
  let firstTokenTime: number | null = null;
  let chunks = 0;
  let fullContent = "";

  const metadata: InferenceMetadata = {
    sessionId,
    conversationId,
    provider: "huggingface" as Provider,
    model,
    requestTimestamp,
    status: "success",
    isStreaming: true,
    inputText: messages[messages.length - 1]?.content,
  };

  try {
    const response = await axios.post(
      BASE_URL,
      {
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: 1024,
        stream: true,
      },
      {
        headers: getHeaders(),
        timeout: 60000,
        responseType: "stream",
      }
    );

    const stream = response.data as NodeJS.ReadableStream;
    let buffer = "";

    for await (const raw of stream) {
      buffer += raw.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content || "";
          if (delta) {
            if (firstTokenTime === null) {
              firstTokenTime = Date.now();
              metadata.timeToFirstTokenMs = firstTokenTime - requestTimestamp.getTime();
            }
            chunks++;
            fullContent += delta;
            yield delta;
          }
          // Capture usage from last chunk
          if (parsed.usage) {
            metadata.promptTokens = parsed.usage.prompt_tokens;
            metadata.completionTokens = parsed.usage.completion_tokens;
            metadata.totalTokens = parsed.usage.total_tokens;
          }
        } catch {
          // skip malformed chunk
        }
      }
    }

    const responseTimestamp = new Date();
    metadata.responseTimestamp = responseTimestamp;
    metadata.latencyMs = responseTimestamp.getTime() - requestTimestamp.getTime();
    metadata.streamChunks = chunks;
    metadata.outputText = fullContent;

    sendLog(metadata).catch(() => {});
  } catch (err: unknown) {
    metadata.status = "error";
    metadata.responseTimestamp = new Date();
    metadata.latencyMs = metadata.responseTimestamp.getTime() - requestTimestamp.getTime();
    if (axios.isAxiosError(err)) {
      metadata.errorMessage = err.response?.data?.error?.message || err.message;
    } else if (err instanceof Error) {
      metadata.errorMessage = err.message;
    }
    sendLog(metadata).catch(() => {});
    throw new Error(metadata.errorMessage || "HuggingFace stream failed");
  }
}
