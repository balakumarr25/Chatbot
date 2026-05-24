import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { Message, InferenceMetadata, Provider } from "../types";
import { sendLog } from "../logger";

let _client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!_client) {
    _client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
  }
  return _client;
}

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
];

function toGeminiHistory(messages: Message[]) {
  const history = messages.slice(0, -1).filter((m) => m.role !== "system");
  return history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

export async function chatGoogle(
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
    provider: "google" as Provider,
    model,
    requestTimestamp,
    status: "success",
    isStreaming: false,
    inputText: messages[messages.length - 1]?.content,
  };

  try {
    const genModel = client.getGenerativeModel({ model, safetySettings: SAFETY_SETTINGS });
    const chat = genModel.startChat({ history: toGeminiHistory(messages) });
    const lastMessage = messages[messages.length - 1]?.content || "";

    const result = await chat.sendMessage(lastMessage);
    const responseTimestamp = new Date();
    const content = result.response.text();

    metadata.responseTimestamp = responseTimestamp;
    metadata.latencyMs = responseTimestamp.getTime() - requestTimestamp.getTime();

    const usage = result.response.usageMetadata;
    if (usage) {
      metadata.promptTokens = usage.promptTokenCount;
      metadata.completionTokens = usage.candidatesTokenCount;
      metadata.totalTokens = usage.totalTokenCount;
    }
    metadata.outputText = content;

    sendLog(metadata).catch(() => {});
    return { content, metadata };
  } catch (err: unknown) {
    metadata.status = "error";
    metadata.responseTimestamp = new Date();
    metadata.latencyMs = metadata.responseTimestamp.getTime() - requestTimestamp.getTime();
    if (err instanceof Error) metadata.errorMessage = err.message;
    sendLog(metadata).catch(() => {});
    throw err;
  }
}

export async function* streamGoogle(
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
    provider: "google" as Provider,
    model,
    requestTimestamp,
    status: "success",
    isStreaming: true,
    inputText: messages[messages.length - 1]?.content,
  };

  try {
    const genModel = client.getGenerativeModel({ model, safetySettings: SAFETY_SETTINGS });
    const chat = genModel.startChat({ history: toGeminiHistory(messages) });
    const lastMessage = messages[messages.length - 1]?.content || "";

    const result = await chat.sendMessageStream(lastMessage);

    for await (const chunk of result.stream) {
      const delta = chunk.text();
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

    const finalResponse = await result.response;
    const responseTimestamp = new Date();
    metadata.responseTimestamp = responseTimestamp;
    metadata.latencyMs = responseTimestamp.getTime() - requestTimestamp.getTime();
    metadata.streamChunks = chunks;
    metadata.outputText = fullContent;

    const usage = finalResponse.usageMetadata;
    if (usage) {
      metadata.promptTokens = usage.promptTokenCount;
      metadata.completionTokens = usage.candidatesTokenCount;
      metadata.totalTokens = usage.totalTokenCount;
    }

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
