import { generateText, stepCountIs, type LanguageModelUsage } from 'ai';

import {
  buildToolsFromRegistry,
  type RegistryToolExtension,
} from './build-tools';
import { composeInstructions } from './compose-instructions';
import type { AiModels } from './create-model';
import type { FetchLike } from './fetch-like';

/** Allow a short tool loop (AI SDK v7 defaults to a single step). */
const CHAT_STOP_WHEN = stepCountIs(5);

export type AgentRegistryPayload = {
  scannedAt?: number;
  extensions: Array<{
    id: string;
    name?: string;
    instructions?: string;
    tools?: Array<Record<string, unknown>>;
  }>;
};

export type RunChatInput = {
  prompt: string;
  models: AiModels;
  gatewayUrl: string;
  registry: AgentRegistryPayload;
  fetchImpl?: FetchLike;
};

export type RunChatResult = {
  text: string;
  instructions: string;
  toolNames: string[];
  usage?: LanguageModelUsage;
};

/** Fetch enabled agent registry from the Vite gateway. */
export async function fetchAgentRegistry(
  gatewayUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<AgentRegistryPayload> {
  const base = gatewayUrl.replace(/\/+$/, '');
  const res = await fetchImpl(`${base}/api/agent/registry`);
  if (!res.ok) {
    throw new Error(`Failed to load agent registry (${res.status})`);
  }
  const body = (await res.json()) as AgentRegistryPayload;
  return {
    scannedAt: body.scannedAt,
    extensions: Array.isArray(body.extensions) ? body.extensions : [],
  };
}

/**
 * Compose instructions + tools from the registry, then run `generateText`.
 */
export async function runChat(input: RunChatInput): Promise<RunChatResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const instructions = composeInstructions(input.registry.extensions);
  const toolExtensions: RegistryToolExtension[] = input.registry.extensions.map(
    (ext) => ({
      id: ext.id,
      tools: Array.isArray(ext.tools) ? ext.tools : [],
    }),
  );
  const tools = buildToolsFromRegistry(
    toolExtensions,
    input.gatewayUrl,
    fetchImpl,
  );
  const toolNames = Object.keys(tools);

  const result = await generateText({
    model: input.models.language,
    system: instructions,
    prompt: input.prompt,
    stopWhen: CHAT_STOP_WHEN,
    ...(toolNames.length > 0 ? { tools } : {}),
  });

  return {
    text: result.text,
    instructions,
    toolNames,
    usage: result.totalUsage,
  };
}
