import Anthropic from "@anthropic-ai/sdk";
import { Message, InferenceMetadata, Provider } from "../types";
import { sendLog } from "../logger";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

function getSystemPrompt(messages: Message[]): string | undefined {
  return messages.find((m) => m.role === "system")?.content;
}

export async function chatAnthropic(
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
    provider: "anthropic" as Provider,
    model,
    requestTimestamp,
    status: "success",
    isStreaming: false,
    inputText: messages[messages.length - 1]?.content,
  };

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: getSystemPrompt(messages),
      messages: toAnthropicMessages(messages),
    });

    const responseTimestamp = new Date();
    const content = response.content[0]?.type === "text" ? response.content[0].text : "";

    metadata.responseTimestamp = responseTimestamp;
    metadata.latencyMs = responseTimestamp.getTime() - requestTimestamp.getTime();
    metadata.promptTokens = response.usage.input_tokens;
    metadata.completionTokens = response.usage.output_tokens;
    metadata.totalTokens = response.usage.input_tokens + response.usage.output_tokens;
    metadata.outputText = content;
    metadata.responseMetadata = { stop_reason: response.stop_reason };

    sendLog(metadata).catch(() => {});
    return { content, metadata };
  } catch (err: unknown) {
    metadata.status = "error";
    metadata.responseTimestamp = new Date();
    metadata.latencyMs = metadata.responseTimestamp.getTime() - requestTimestamp.getTime();
    if (err instanceof Anthropic.APIError) {
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

export async function* streamAnthropic(
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
    provider: "anthropic" as Provider,
    model,
    requestTimestamp,
    status: "success",
    isStreaming: true,
    inputText: messages[messages.length - 1]?.content,
  };

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 2048,
      system: getSystemPrompt(messages),
      messages: toAnthropicMessages(messages),
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const delta = event.delta.text;
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
    }

    const finalMessage = await stream.finalMessage();
    const responseTimestamp = new Date();
    metadata.responseTimestamp = responseTimestamp;
    metadata.latencyMs = responseTimestamp.getTime() - requestTimestamp.getTime();
    metadata.promptTokens = finalMessage.usage.input_tokens;
    metadata.completionTokens = finalMessage.usage.output_tokens;
    metadata.totalTokens = finalMessage.usage.input_tokens + finalMessage.usage.output_tokens;
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
