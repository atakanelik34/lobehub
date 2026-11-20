import type { AgentState } from '@lobechat/agent-runtime';
import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import {
  generateToolsFromManifest,
  renderToolInstructions,
  type ResolvedToolSet,
} from '@lobechat/context-engine';
import type { ContextEngineeringResult } from '@lobechat/mecha';
import type { ResolveToolActivationContext, ToolActivationContext } from '@lobechat/types';

import {
  serverMessagesEngine,
  type ServerMessagesEngineParams,
} from '@/server/modules/Mecha/ContextEngineering';

import { buildToolDiscoveryConfig } from '../executorHelpers';

function generatedPrefix({ messages, metadata }: ContextEngineeringResult) {
  const prefix: NonNullable<ToolActivationContext['prefix']>['current'] = [];
  const system = messages[0];
  if (system?.role === 'system' && typeof system.content === 'string') {
    prefix.push({ content: system.content, role: 'system' });
  }
  const injected = metadata.messageCleanup?.systemInjectionIndex;
  if (injected !== undefined) {
    const message = messages[injected];
    if (
      injected !== prefix.length ||
      message?.role !== 'user' ||
      typeof message.content !== 'string'
    )
      return;
    prefix.push({ content: message.content, role: 'user' });
  }
  return prefix;
}

export function createToolActivationResolver(
  state: AgentState,
  resolved: ResolvedToolSet,
  input: ServerMessagesEngineParams,
  canonical: ContextEngineeringResult,
): ResolveToolActivationContext | undefined {
  const initial = state.operationToolSet;
  if (!initial || !resolved.enabledToolIds.includes(LobeActivatorIdentifier)) return;
  return async () => {
    const additions: ToolActivationContext['additions'] = [];
    const deferred = new Set<string>();
    const visibleResults = new Set(
      canonical.messages
        .filter((message) => message.role === 'tool')
        .map((message) => message.tool_call_id),
    );
    for (const activation of state.activatedStepTools ?? []) {
      const manifest = resolved.promptManifestMap[activation.id];
      if (
        !activation.afterToolCallId ||
        !visibleResults.has(activation.afterToolCallId) ||
        !manifest ||
        initial.enabledToolIds.includes(activation.id)
      )
        continue;
      const instructions = renderToolInstructions([manifest]);
      // A templated manifest must keep the context engine's variable hydration.
      if (instructions.includes('{{') || input.evalContext?.sessionDate) continue;
      additions.push({
        afterToolCallId: activation.afterToolCallId,
        instructions,
        names: generateToolsFromManifest(manifest).map((tool) => tool.function.name),
      });
      deferred.add(activation.id);
    }
    if (additions.length === 0) return { additions };

    // Reuse the authorized snapshot. Take only the generated leading messages from
    // this projection; the actual conversation and tool results retain their normal processing.
    const enabled = resolved.enabledToolIds.filter((id) => !deferred.has(id));
    const baseline = await serverMessagesEngine({
      ...input,
      toolDiscoveryConfig: buildToolDiscoveryConfig(initial, enabled),
      toolsConfig: {
        ...input.toolsConfig,
        tools: enabled,
        manifests: input.toolsConfig?.manifests?.filter(
          (manifest) => !deferred.has(manifest.identifier),
        ),
      },
    });
    const current = generatedPrefix(canonical);
    const original = generatedPrefix(baseline);
    if (current && original) return { additions, prefix: { current, initial: original } };
  };
}
