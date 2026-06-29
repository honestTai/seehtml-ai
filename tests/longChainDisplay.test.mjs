import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLongChainPhases } from '../src/lib/longChainDisplay.ts';

test('buildLongChainPhases shows the three LongChain stages with idle defaults', () => {
  const phases = buildLongChainPhases([], false);

  assert.deepEqual(phases.map((phase) => phase.id), ['plan', 'execute', 'synthesize']);
  assert.deepEqual(phases.map((phase) => phase.status), ['idle', 'idle', 'idle']);
  assert.equal(phases[0].label.zh, '规划');
  assert.equal(phases[2].label.en, 'Synthesize');
});

test('buildLongChainPhases maps active processing into plan execute synthesize states', () => {
  const phases = buildLongChainPhases([
    { id: 'p1', title: '规划请求', detail: 'Plan route', status: 'done' },
    { id: 'e1', title: '调用工具', detail: 'Execute tool', status: 'active' },
    { id: 's1', title: '整理结果', detail: 'Synthesize final HTML', status: 'pending' },
  ], true);

  assert.deepEqual(phases.map((phase) => phase.status), ['done', 'active', 'pending']);
  assert.equal(phases[1].detail, 'Execute tool');
});
