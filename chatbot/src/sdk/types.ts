export type Provider = "openai" | "anthropic" | "deepseek" | "xai" | "huggingface";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface InferenceMetadata {
  conversationId?: string;
  sessionId: string;
  provider: Provider;
  model: string;
  requestTimestamp: Date;
  responseTimestamp?: Date;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  status: "success" | "error" | "cancelled" | "timeout";
  errorCode?: string;
  errorMessage?: string;
  httpStatusCode?: number;
  inputText?: string;
  outputText?: string;
  isStreaming: boolean;
  streamChunks?: number;
  timeToFirstTokenMs?: number;
  requestMetadata?: Record<string, unknown>;
  responseMetadata?: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  metadata: InferenceMetadata;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

export interface ProviderConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export const PROVIDER_MODELS: Record<Provider, string[]> = {
  openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-haiku-20240307"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  xai: ["grok-2", "grok-2-mini"],
  huggingface: [
    "Qwen/Qwen2.5-72B-Instruct",
    "Qwen/Qwen2.5-7B-Instruct",
    "Qwen/Qwen2.5-Coder-32B-Instruct",
    "meta-llama/Llama-3.3-70B-Instruct",
    "mistralai/Mistral-7B-Instruct-v0.3",
    "mistralai/Mixtral-8x7B-Instruct-v0.1",
  ],
};
