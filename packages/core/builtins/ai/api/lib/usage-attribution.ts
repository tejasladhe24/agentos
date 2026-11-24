import { appendEntry } from '@agentos/core/api/audit';
import type { EnvMap } from '@agentos/core/api/http';

import type { AiModelSource } from './ai-integration';

export const AI_USAGE_AUDIT_ACTION = 'ai.usage';

export type AiOperation = 'generate-text' | 'generate-image' | 'embed' | 'chat';

/** One AI call, attributed to whoever pays for it (`org` key vs `platform`). */
export type AiUsageEvent = {
  orgId: string | null;
  source: AiModelSource;
  provider: string;
  model: string;
  operation: AiOperation;
  inputTokens?: number;
  outputTokens?: number;
};

export type AiUsageRecorder = (event: AiUsageEvent) => void | Promise<void>;

/** Token counts from AI SDK usage objects (language `{input,output}Tokens`, embed `{tokens}`). */
export function usageTokens(
  usage: unknown,
): Pick<AiUsageEvent, 'inputTokens' | 'outputTokens'> {
  if (!usage || typeof usage !== 'object') return {};
  const u = usage as Record<string, unknown>;
  const out: Pick<AiUsageEvent, 'inputTokens' | 'outputTokens'> = {};
  const input = typeof u.inputTokens === 'number' ? u.inputTokens : u.tokens;
  if (typeof input === 'number') out.inputTokens = input;
  if (typeof u.outputTokens === 'number') out.outputTokens = u.outputTokens;
  return out;
}

/**
 * Default recorder: one `ai.usage` audit entry per real-provider call in the
 * org's log. Mock calls and requests without an org are not recorded.
 */
export function createAuditUsageRecorder(env?: EnvMap): AiUsageRecorder {
  return async (event) => {
    if (!event.orgId || event.provider === 'mock') return;
    const { orgId, operation, ...meta } = event;
    try {
      await appendEntry(
        { action: AI_USAGE_AUDIT_ACTION, resource: operation, meta },
        env,
        { orgId },
      );
    } catch {
      // usage attribution must never fail the AI call
    }
  };
}
