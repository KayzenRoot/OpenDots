import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import {
  PageTitleField,
  singleLineTitle,
} from '../src/client/editor/PageTitleField';
import { setLocalePreference } from '../src/client/i18n';
// These assertions cover the English copy; pin it regardless of the machine.
setLocalePreference('en');

it('renders the page title as a wrapping textarea so long titles are not clipped', () => {
  const html = renderToStaticMarkup(
    <PageTitleField
      value="AI Coworkers: OpenAI Dots vs Meta Muse vs OpenDots"
      onChange={() => {}}
    />,
  );
  // A single-line <input> clipped long titles; the field must be a textarea.
  expect(html).toContain('<textarea');
  expect(html).not.toContain('<input');
  expect(html).toContain('class="document-title"');
  expect(html).toContain('aria-label="Page title"');
  expect(html).toContain('rows="1"');
  expect(html).toContain('maxLength="160"');
  expect(html).toContain('AI Coworkers: OpenAI Dots vs Meta Muse vs OpenDots');
});

it('keeps the title on a single logical line when text with line breaks is pasted', () => {
  expect(singleLineTitle('First\nSecond\r\nThird')).toBe('First Second Third');
  expect(singleLineTitle('Plain title')).toBe('Plain title');
});

it('styles the title field so wrapped text grows and never clips', () => {
  // jsdom cannot lay out a textarea, so assert the wrapping rules directly:
  // the field must wrap anywhere, hide its own scrollbar, and not be
  // user-resizable while the component fits it to the content.
  const css = readFileSync('src/client/editor.css', 'utf8');
  const rule = css.match(/\.document-title\s*\{[^}]*\}/)?.[0];
  expect(rule).toBeTruthy();
  expect(rule).toContain('overflow-wrap: anywhere');
  expect(rule).toContain('overflow: hidden');
  expect(rule).toContain('resize: none');
});
