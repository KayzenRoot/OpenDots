import { expect, it } from 'vitest';
import type { Page } from '../src/server/pages';
import { mergePageSnapshot } from '../src/client/page-snapshots';
const base: Page = {
  id: 'existing',
  spaceId: 'space',
  parentId: null,
  title: 'Existing',
  content: '',
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
  sourceThreadId: null,
};
it('retains a newly created document when an earlier list response arrives after creation', async () => {
  let resolve!: (pages: Page[]) => void;
  const olderRead = new Promise<Page[]>((done) => {
    resolve = done;
  });
  let pages = [base];
  const created = { ...base, id: 'new-page', title: 'New page' };
  const selectedId = created.id;
  const pending = olderRead.then((snapshot) => {
    // A poll that started before the create is not proof of absence: the
    // caller retains every row it already had when the poll began.
    pages = mergePageSnapshot(
      pages,
      snapshot,
      new Set(),
      new Set(pages.map((page) => page.id)),
    );
  });
  pages = [...pages, created];
  resolve([base]);
  await pending;
  expect(pages.find((page) => page.id === selectedId)).toBe(created);
  expect(pages).toHaveLength(2);
});
it('drops rows a fresh complete list no longer contains unless they are retained', () => {
  const kept = { ...base, id: 'kept', title: 'Kept' };
  const gone = { ...base, id: 'gone', title: 'Deleted elsewhere' };
  // Another tab deleted `gone`; a fresh poll omits it, so the row is dropped.
  expect(mergePageSnapshot([kept, gone], [kept])).toEqual([kept]);
  // The open document survives even when its row is absent from the list.
  expect(
    mergePageSnapshot([kept, gone], [kept], new Set(), new Set(['gone'])),
  ).toEqual([kept, gone]);
});
it('retains locally saved revisions while accepting newer remote pages', () => {
  const local = { ...base, revision: 3, content: 'Saved locally' };
  const remote = { ...base, id: 'remote', content: 'Other page' };
  expect(mergePageSnapshot([local], [base, remote])).toEqual([local, remote]);
  expect(
    mergePageSnapshot([local], [{ ...base, revision: 4, content: 'Latest' }])[0]
      .content,
  ).toBe('Latest');
});

it('ignores a stale poll that still lists a deleted page', () => {
  const gone = { ...base, id: 'gone' };
  expect(mergePageSnapshot([base], [base, gone], new Set(['gone']))).toEqual([
    base,
  ]);
});
