/**
 * LLM SDK — unified interface for multi-provider inference with automatic logging.
 */
import { Message, Provider, PROVIDER_MODELS } from "./types";
import { chatOpenAI, streamOpenAI } from "./providers/openai";
import { chatAnthropic, streamAnthropic } from "./providers/anthropic";
import { chatOpenAICompat, streamOpenAICompat } from "./providers/openai_compat";
import { chatHuggingFace, streamHuggingFace } from "./providers/huggingface";

export { PROVIDER_MODELS, Provider };
export type { Message };

export function getAvailableProviders(): Provider[] {
  const providers: Provider[] = [];
  if (process.env.OPENAI_API_KEY) providers.push("openai");
  if (process.env.ANTHROPIC_API_KEY) providers.push("anthropic");
  if (process.env.DEEPSEEK_API_KEY) providers.push("deepseek");
  if (process.env.XAI_API_KEY) providers.push("xai");
  if (process.env.HUGGINGFACE_API_KEY) providers.push("huggingface");
  return providers;
}

export async function chat(
  messages: Message[],
  provider: Provider,
  model: string,
  sessionId: string,
  conversationId?: string
): Promise<{ content: string }> {
  switch (provider) {
    case "openai":
      return chatOpenAI(messages, model, sessionId, conversationId);
    case "anthropic":
      return chatAnthropic(messages, model, sessionId, conversationId);
    case "deepseek":
    case "xai":
      return chatOpenAICompat(messages, model, provider, sessionId, conversationId);
    case "huggingface":
      return chatHuggingFace(messages, model, sessionId, conversationId);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

export async function* stream(
  messages: Message[],
  provider: Provider,
  model: string,
  sessionId: string,
  conversationId?: string
): AsyncGenerator<string> {
  switch (provider) {
    case "openai":
      yield* streamOpenAI(messages, model, sessionId, conversationId);
      break;
    case "anthropic":
      yield* streamAnthropic(messages, model, sessionId, conversationId);
      break;
    case "deepseek":
    case "xai":
      yield* streamOpenAICompat(messages, model, provider, sessionId, conversationId);
      break;
    case "huggingface":
      yield* streamHuggingFace(messages, model, sessionId, conversationId);
      break;
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
