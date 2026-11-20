// @vitest-environment node
import type { AgentState } from '@lobechat/agent-runtime';
import { LobeActivatorManifest } from '@lobechat/builtin-tool-activator';
import { AgentDocumentsManifest } from '@lobechat/builtin-tool-agent-documents';
import {
  generateToolsFromManifest,
  type LobeToolManifest,
  ToolResolver,
} from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';
import { expect, it } from 'vitest';

import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';

import { buildToolDiscoveryConfig } from '../executorHelpers';
import { createToolActivationResolver } from './serverToolActivationContext';

it('restores the initial system and discovery catalog when the final discoverable document tool is activated', async () => {
  const activator = LobeActivatorManifest as LobeToolManifest;
  const documents = AgentDocumentsManifest as LobeToolManifest;
  const operationToolSet = {
    enabledToolIds: [activator.identifier],
    manifestMap: { [activator.identifier]: activator, [documents.identifier]: documents },
    sourceMap: {},
    tools: generateToolsFromManifest(activator),
  };
  const activation = {
    activatedAtStep: 1,
    afterToolCallId: 'activate-documents',
    id: documents.identifier,
    manifest: documents,
    source: 'discovery' as const,
  };
  const toolResolver = new ToolResolver();
  const before = toolResolver.resolve(operationToolSet, { activatedTools: [] });
  const after = toolResolver.resolve(operationToolSet, { activatedTools: [] }, [activation]);
  const user = { id: 'user', content: 'read my document', role: 'user' } as UIChatMessage;
  const call = {
    apiName: 'activateTools',
    identifier: activator.identifier,
    arguments: '{}',
    id: activation.afterToolCallId,
    type: 'builtin',
  };
  const input = (resolved: typeof before, messages: UIChatMessage[]) => ({
    messages,
    model: 'claude-sonnet-5-5',
    provider: 'anthropic',
    systemRole: 'Keep answers short.',
    toolsConfig: {
      manifests: Object.values(resolved.promptManifestMap),
      tools: resolved.enabledToolIds,
    },
    toolDiscoveryConfig: buildToolDiscoveryConfig(operationToolSet, resolved.enabledToolIds),
  });
  const initial = await serverMessagesEngine(input(before, [user]));
  const history = [
    user,
    { id: 'assistant', role: 'assistant', content: '', tools: [call] },
    {
      id: 'result',
      role: 'tool',
      tool_call_id: call.id,
      plugin: call,
      content: 'Activated documents.',
    },
  ] as UIChatMessage[];
  const next = input(after, history);
  const canonical = await serverMessagesEngine(next);
  const state = { activatedStepTools: [activation], operationToolSet } as AgentState;
  const delta = await createToolActivationResolver(state, after, next, canonical)?.();
  expect(delta?.additions).toEqual([
    {
      afterToolCallId: call.id,
      instructions: expect.stringContaining(documents.systemRole!),
      names: generateToolsFromManifest(documents).map((tool) => tool.function.name),
    },
  ]);
  expect(delta?.prefix?.initial).toEqual(initial.messages.slice(0, -1));
  expect(
    delta?.prefix?.initial.some((message) => message.content.includes(documents.identifier)),
  ).toBe(true);
  expect(delta?.prefix?.current).toEqual(
    canonical.messages.slice(0, delta?.prefix?.current.length),
  );
  // A truncated/pruned result cannot lend its old position to a definition.
  const truncated = await serverMessagesEngine(input(after, [user]));
  expect(await createToolActivationResolver(state, after, next, truncated)?.()).toEqual({
    additions: [],
  });
});
