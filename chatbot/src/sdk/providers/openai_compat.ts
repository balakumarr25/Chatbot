/**
 * OpenAI-compatible provider for DeepSeek and xAI (Grok).
 * Both use the OpenAI SDK with a custom baseURL.
 */
import OpenAI from "openai";
import { Message, InferenceMetadata, Provider } from "../types";
import { sendLog } from "../logger";

const PROVIDER_CONFIGS: Record<string, { baseURL: string; envKey: string }> = {
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
  },
  xai: {
    baseURL: "https://api.x.ai/v1",
    envKey: "XAI_API_KEY",
  },
};

const _clients: Record<string, OpenAI> = {};

function getClient(provider: string): OpenAI {
  if (!_clients[provider]) {
    const config = PROVIDER_CONFIGS[provider];
    if (!config) throw new Error(`Unknown provider: ${provider}`);
    _clients[provider] = new OpenAI({
      apiKey: process.env[config.envKey] || "",
      baseURL: config.baseURL,
    });
  }
  return _clients[provider];
}

export async function chatOpenAICompat(
  messages: Message[],
  model: string,
  provider: string,
  sessionId: string,
  conversationId?: string
): Promise<{ content: string; metadata: InferenceMetadata }> {
  const client = getClient(provider);
  const requestTimestamp = new Date();

  const metadata: InferenceMetadata = {
    sessionId,
    conversationId,
    provider: provider as Provider,
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

export async function* streamOpenAICompat(
  messages: Message[],
  model: string,
  provider: string,
  sessionId: string,
  conversationId?: string
): AsyncGenerator<string> {
  const client = getClient(provider);
  const requestTimestamp = new Date();
  let firstTokenTime: number | null = null;
  let chunks = 0;
  let fullContent = "";

  const metadata: InferenceMetadata = {
    sessionId,
    conversationId,
    provider: provider as Provider,
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
