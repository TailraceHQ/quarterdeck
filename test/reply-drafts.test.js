import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureReplyDrafts, restoreReplyDrafts } from '../web/reply-drafts.js';

function replyInput({ id, value = '', focused = false, selectionStart, selectionEnd }) {
  const task = { dataset: { id } };
  const input = {
    value,
    selectionStart: selectionStart ?? value.length,
    selectionEnd: selectionEnd ?? value.length,
    dataset: { act: 'reply' },
    closest: () => task,
    focus() {
      input._focused = true;
    },
    setSelectionRange(start, end) {
      input.selectionStart = start;
      input.selectionEnd = end;
    },
  };
  if (focused) input._focused = true;
  return input;
}

function board(inputs) {
  return {
    querySelectorAll: (sel) => (sel.includes('reply') ? inputs : []),
  };
}

test('captureReplyDrafts keeps typed text and caret by task id', () => {
  const typed = replyInput({ id: 'T-0003', value: 'please keep this', selectionStart: 6, selectionEnd: 6, focused: true });
  const other = replyInput({ id: 'T-0001', value: 'second draft' });
  const empty = replyInput({ id: 'T-0002', value: '' });

  const drafts = captureReplyDrafts(board([typed, other, empty]), typed);

  assert.equal(drafts.size, 2);
  assert.deepEqual(drafts.get('T-0003'), {
    value: 'please keep this',
    focused: true,
    selectionStart: 6,
    selectionEnd: 6,
  });
  assert.deepEqual(drafts.get('T-0001'), {
    value: 'second draft',
    focused: false,
    selectionStart: 12,
    selectionEnd: 12,
  });
  assert.equal(drafts.has('T-0002'), false);
});

test('captureReplyDrafts keeps focus on an empty reply the user is typing in', () => {
  const focused = replyInput({ id: 'T-0003', value: '', focused: true });
  const drafts = captureReplyDrafts(board([focused]), focused);

  assert.equal(drafts.size, 1);
  assert.equal(drafts.get('T-0003').focused, true);
  assert.equal(drafts.get('T-0003').value, '');
});

test('restoreReplyDrafts writes values back and restores caret after a DOM replace', () => {
  const fresh = replyInput({ id: 'T-0003', value: '' });
  const leftovers = replyInput({ id: 'T-0099', value: '' });
  const drafts = new Map([
    [
      'T-0003',
      { value: 'hello from the board', focused: true, selectionStart: 5, selectionEnd: 5 },
    ],
    ['T-gone', { value: 'task left the board', focused: false, selectionStart: 0, selectionEnd: 0 }],
  ]);

  restoreReplyDrafts(board([fresh, leftovers]), drafts);

  assert.equal(fresh.value, 'hello from the board');
  assert.equal(fresh._focused, true);
  assert.equal(fresh.selectionStart, 5);
  assert.equal(fresh.selectionEnd, 5);
  assert.equal(leftovers.value, '');
});

test('restoreReplyDrafts is a no-op when nothing was captured', () => {
  const input = replyInput({ id: 'T-0003', value: '' });
  restoreReplyDrafts(board([input]), new Map());
  restoreReplyDrafts(board([input]), null);
  assert.equal(input.value, '');
  assert.equal(input._focused, undefined);
});
