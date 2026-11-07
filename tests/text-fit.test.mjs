import test from 'node:test';
import assert from 'node:assert/strict';
import { fitTextInBox } from '../public/engine.js';

function context() {
  return { font: '', measureText(text) {
    const size = Number(this.font.match(/([\d.]+)px/)[1]);
    return { width: [...text].length * size * 0.6, actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2 };
  } };
}
test('long replacement shrinks within original width and height', () => {
  const ctx = context();
  const layout = fitTextInBox(ctx, 'Un text mult mai lung', { width: 180, height: 30, fontSize: 30, minFontSize: 10 });
  assert.ok(layout && layout.size < 30);
  assert.ok(layout.height <= 30);
  assert.ok(layout.lines.every(line => ctx.measureText(line).width <= 180));
});
test('button text wraps only when both lines fit', () => {
  const ctx = context();
  const layout = fitTextInBox(ctx, 'Comanda produsul', { width: 100, height: 50, fontSize: 20, minFontSize: 10 });
  assert.equal(layout.lines.length, 2);
  assert.ok(layout.height <= 50);
});
test('does not truncate an unbreakable word to make it fit', () => {
  assert.equal(fitTextInBox(context(), 'a'.repeat(100), { width: 80, height: 40, fontSize: 24, minFontSize: 14 }), null);
});
test('keeps readable text at its original size', () => {
  assert.equal(fitTextInBox(context(), 'VitaBoost', { width: 300, height: 40, fontSize: 24 }).size, 24);
});
test('rejects missing space rather than overflowing', () => {
  assert.equal(fitTextInBox(context(), 'Text', { width: 0, height: 20, fontSize: 20 }), null);
});
