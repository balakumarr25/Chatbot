import OpenAI from "openai";
import { Message, InferenceMetadata, Provider } from "../types";
import { sendLog } from "../logger";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

export async function chatOpenAI(
  messages: Message[],
  model: string,
  sessionId: string,
  conversationId?: string
): Promise<{ content: string; metadata: InferenceMetadata }> {
  const client = getClient();
  const requestTimestamp = new Date();

  const metadata: InferenceMetadata = {
    sessionId,
    conversationId,
    provider: "openai" as Provider,
    model,
    requestTimestamp,
    status: "success",
    isStreaming: false,
    inputText: messages[messages.length - 1]?.content,
  };

  try {
    const response = await client.chat.completions.create({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 2048,
    });

    const responseTimestamp = new Date();
    const content = response.choices[0]?.message?.content || "";

    metadata.responseTimestamp = responseTimestamp;
    metadata.latencyMs = responseTimestamp.getTime() - requestTimestamp.getTime();
    metadata.promptTokens = response.usage?.prompt_tokens;
    metadata.completionTokens = response.usage?.completion_tokens;
    metadata.totalTokens = response.usage?.total_tokens;
    metadata.outputText = content;
    metadata.responseMetadata = { finish_reason: response.choices[0]?.finish_reason };

    // Fire-and-forget log
    sendLog(metadata).catch(() => {});

    return { content, metadata };
  } catch (err: unknown) {
    metadata.status = "error";
    metadata.responseTimestamp = new Date();
    metadata.latencyMs = metadata.responseTimestamp.getTime() - requestTimestamp.getTime();

    if (err instanceof OpenAI.APIError) {
      metadata.errorCode = String(err.status);
      metadata.errorMessage = err.message;
      metadata.httpStatusCode = err.status;
    } else if (err instanceof Error) {
      metadata.errorMessage = err.message;
    }

    sendLog(metadata).catch(() => {});
    throw err;
  }
}

export async function* streamOpenAI(
  messages: Message[],
  model: string,
  sessionId: string,
  conversationId?: string
): AsyncGenerator<string> {
  const client = getClient();
  const requestTimestamp = new Date();
  let firstTokenTime: number | null = null;
  let chunks = 0;
  let fullContent = "";

  const metadata: InferenceMetadata = {
    sessionId,
    conversationId,
    provider: "openai" as Provider,
    model,
    requestTimestamp,
    status: "success",
    isStreaming: true,
    inputText: messages[messages.length - 1]?.content,
  };

  try {
    const stream = await client.chat.completions.create({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 2048,
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";
      if (delta) {
        if (firstTokenTime === null) {
          firstTokenTime = Date.now();
          metadata.timeToFirstTokenMs = firstTokenTime - requestTimestamp.getTime();
        }
        chunks++;
        fullContent += delta;
        yield delta;
      }
      if (chunk.usage) {
        metadata.promptTokens = chunk.usage.prompt_tokens;
        metadata.completionTokens = chunk.usage.completion_tokens;
        metadata.totalTokens = chunk.usage.total_tokens;
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
    if (err instanceof Error) metadata.errorMessage = err.message;
    sendLog(metadata).catch(() => {});
    throw err;
  }
}
