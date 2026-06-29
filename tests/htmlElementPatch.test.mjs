import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyElementPatch,
  buildElementEditPrompt,
  mergeInlineStyle,
} from '../src/lib/htmlElementPatch.ts';

test('mergeInlineStyle updates safe declarations and keeps existing styles', () => {
  const style = mergeInlineStyle('color: red; padding: 8px; transform: scale(1.1);', {
    color: '#123456',
    fontSize: '28px',
    borderRadius: '16px',
    marginTop: '12px',
    transform: 'rotate(10deg)',
  });

  assert.equal(
    style,
    'color: #123456; padding: 8px; font-size: 28px; border-radius: 16px; margin-top: 12px',
  );
});

test('applyElementPatch updates text and inline style for the targeted element path', () => {
  const html = '<!DOCTYPE html><html><body><main><section><h1 style="color: red">Old title</h1><p>Body</p></section></main></body></html>';
  const result = applyElementPatch(html, {
    path: 'html:nth-of-type(1) > body:nth-of-type(1) > main:nth-of-type(1) > section:nth-of-type(1) > h1:nth-of-type(1)',
    text: 'New title',
    style: {
      color: '#0f766e',
      fontSize: '42px',
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.html, /<h1 style="color: #0f766e; font-size: 42px">New title<\/h1>/);
  assert.match(result.html, /<p>Body<\/p>/);
});

test('applyElementPatch replaces only the start tag when text length changes', () => {
  const html = '<html><body><h1 style="color: red">Short</h1><p>Next</p></body></html>';
  const result = applyElementPatch(html, {
    path: 'html:nth-of-type(1) > body:nth-of-type(1) > h1:nth-of-type(1)',
    text: 'A much longer heading',
    style: { color: '#111111' },
  });

  assert.equal(result.ok, true);
  assert.match(result.html, /<h1 style="color: #111111">A much longer heading<\/h1>/);
  assert.match(result.html, /<p>Next<\/p>/);
});

test('applyElementPatch returns the original html when the target path is missing', () => {
  const html = '<html><body><h1>Title</h1></body></html>';
  const result = applyElementPatch(html, {
    path: 'html:nth-of-type(1) > body:nth-of-type(1) > main:nth-of-type(1)',
    text: 'Ignored',
  });

  assert.equal(result.ok, false);
  assert.equal(result.html, html);
});

test('buildElementEditPrompt includes selected element context without full html', () => {
  const prompt = buildElementEditPrompt({
    tagName: 'h1',
    path: 'html:nth-of-type(1) > body:nth-of-type(1) > h1:nth-of-type(1)',
    text: 'Quarterly report',
    pageLabel: 'Page 2',
    className: 'hero-title',
    style: {
      color: 'rgb(15, 23, 42)',
      fontSize: '48px',
    },
  }, '把标题改得更有冲击力');

  assert.match(prompt, /选中元素/);
  assert.match(prompt, /Page 2/);
  assert.match(prompt, /hero-title/);
  assert.match(prompt, /把标题改得更有冲击力/);
  assert.doesNotMatch(prompt, /<!DOCTYPE html>/i);
});
