// Captures in-progress replies so a live board refresh can restore them
// after replacing the DOM. Empty unfocused inputs are skipped.
export function captureReplyDrafts(root, activeEl) {
  const drafts = new Map();
  if (!root) return drafts;
  for (const input of root.querySelectorAll('[data-act="reply"]')) {
    const id = input.closest('.task')?.dataset?.id;
    if (!id) continue;
    const focused = activeEl === input;
    if (!input.value && !focused) continue;
    drafts.set(id, {
      value: input.value,
      focused,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
    });
  }
  return drafts;
}

export function restoreReplyDrafts(root, drafts) {
  if (!root || !drafts?.size) return;
  for (const input of root.querySelectorAll('[data-act="reply"]')) {
    const id = input.closest('.task')?.dataset?.id;
    const draft = id && drafts.get(id);
    if (!draft) continue;
    input.value = draft.value;
    if (!draft.focused) continue;
    input.focus();
    const start = draft.selectionStart;
    const end = draft.selectionEnd;
    if (typeof start === 'number' && typeof end === 'number' && typeof input.setSelectionRange === 'function') {
      try {
        input.setSelectionRange(start, end);
      } catch {
        /* some input types reject selection ranges */
      }
    }
  }
}
