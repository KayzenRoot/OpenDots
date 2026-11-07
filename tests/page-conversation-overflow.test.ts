import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

/**
 * The page conversation panel (#34) clipped message bubbles and the review
 * card on the right at ~1320px with a horizontal scrollbar. The content that
 * pushed the panel wide was Markdown tables and long unbroken tokens inside
 * bubbles and the review card. jsdom cannot lay out these elements, so this
 * regression pins the containment rules in the real stylesheets: tables wrap
 * within their container (fixed layout at 100% width) and every text
 * container wraps long tokens instead of growing.
 */
const read = (path: string) => readFileSync(path, 'utf8');
const rule = (css: string, selector: string) => {
  const match = css
    .replace(/\s+/g, ' ')
    .match(
      new RegExp(
        `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
      ),
    );
  expect(match, `rule ${selector} not found`).toBeTruthy();
  return match![1];
};

it('keeps markdown tables inside chat bubbles and the review card', () => {
  const css = read('src/client/style.css');
  for (const selector of ['.chat-bubble table', '.page-review-body table']) {
    const body = rule(css, selector);
    expect(body).toContain('width: 100%');
    expect(body).toContain('max-width: 100%');
    expect(body).toContain('table-layout: fixed');
  }
  for (const selector of [
    '.chat-bubble td, .chat-bubble th',
    '.page-review-body td, .page-review-body th',
  ]) {
    expect(rule(css, selector)).toContain('overflow-wrap: anywhere');
  }
});

it('wraps long tokens in the review body and the page chat panel', () => {
  expect(rule(read('src/client/style.css'), '.page-review-body')).toContain(
    'overflow-wrap: anywhere',
  );
  expect(rule(read('src/client/editor.css'), '.document-chat-panel')).toContain(
    'min-width: 0',
  );
});
