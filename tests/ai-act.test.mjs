import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

for (const file of ['public/engine.js', 'addon/src/ui/engine.js']) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const { checkAiAct, score } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const realistic = { photorealistic: true, depictsRealPersonLike: true, disclosureRequired: true };
  const ai = { aiGenerated: true };
  const cases = [
    ['AI realistic', realistic, ai, false, 'error', 60],
    ['unknown provenance', realistic, {}, false, 'warning', 85],
    ['C2PA and visual evidence override omitted verdict', { ...realistic, disclosureRequired: false }, ai, false, 'error', 60],
    ['stylized despite contradictory verdict', { ...realistic, photorealistic: false }, ai, false, 'info', 100],
    ['stylized without provenance', { ...realistic, photorealistic: false }, {}, false, null, 100],
    ['no resemblance to reality', { ...realistic, depictsRealPersonLike: false }, ai, false, 'info', 100],
    ['real photograph without AI evidence', { ...realistic, disclosureRequired: false }, {}, false, null, 100],
    ['existing label', realistic, ai, true, null, 100],
    ['missing audit', null, ai, false, null, 100],
  ];
  for (const [name, disclosure, provenance, labeled, severity, axisScore] of cases) {
    test(`${file}: ${name}`, () => {
      const issues = checkAiAct(disclosure, provenance, labeled);
      assert.equal(issues.length, severity ? 1 : 0);
      assert.equal(issues[0]?.severity ?? null, severity);
      assert.equal(score(issues).axes.ai_act, axisScore);
      if (severity) assert.deepEqual(issues[0].fix, { kind: 'label' });
    });
  }
  test(`${file}: fixed issue no longer lowers score`, () => {
    const issues = checkAiAct(realistic, ai).map(issue => ({ ...issue, fixed: true }));
    assert.equal(score(issues).total, 100);
  });
}
