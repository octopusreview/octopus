export type BlogEdit = { before: string; after: string };
export type EditablePost = { title: string; excerpt: string | null; content: string };
export type BlogEditResult = {
  /** Only the fields that differ from the post as given. */
  changed: Partial<Record<keyof EditablePost, string>>;
  applied: number;
  alreadyApplied: number;
  /** Non-empty means the post must not be saved. */
  problems: string[];
};

const FIELDS = ["title", "excerpt", "content"] as const;
const occurrences = (text: string, part: string) => {
  let count = 0;
  for (let index = text.indexOf(part); index !== -1; index = text.indexOf(part, index + 1)) count++;
  return count;
};
const preview = (text: string) => (text.length > 70 ? `${text.slice(0, 70)}…` : text);

/**
 * Applies exact-text replacements to one post. Each `before` must occur
 * exactly once across the title, excerpt and body. An edit whose `before` is
 * absent while its `after` is present counts as already applied. This also
 * covers deletions, since an empty `after` is present in every field.
 *
 * Two kinds of edit are refused, because a second run could not tell whether
 * they had been applied: one whose new text contains its old text, and one
 * whose new text is changed again by another edit in the same list.
 */
export function applyBlogEdits(post: EditablePost, edits: BlogEdit[]): BlogEditResult {
  const text = { title: post.title, excerpt: post.excerpt ?? "", content: post.content };
  const result: BlogEditResult = { changed: {}, applied: 0, alreadyApplied: 0, problems: [] };
  for (const edit of edits) {
    if (!edit.before) {
      result.problems.push('not found: ""');
      continue;
    }
    if (edit.after.includes(edit.before)) {
      result.problems.push(`new text contains the old text, so a second run would apply it again: "${preview(edit.before)}"`);
      continue;
    }
    const found = FIELDS.reduce((sum, field) => sum + occurrences(text[field], edit.before), 0);
    if (found === 1) {
      const field = FIELDS.find((name) => text[name].includes(edit.before))!;
      text[field] = text[field].replace(edit.before, () => edit.after);
      result.applied++;
    } else if (found === 0 && FIELDS.some((field) => text[field].includes(edit.after))) {
      result.alreadyApplied++;
    } else {
      result.problems.push(`${found === 0 ? "not found" : `found ${found} times`}: "${preview(edit.before)}"`);
    }
  }
  // Every edit's new text must still be there at the end. If another edit
  // changed it, a second run would report this one as not found.
  if (result.problems.length === 0) {
    for (const edit of edits) {
      if (!FIELDS.some((field) => text[field].includes(edit.after))) {
        result.problems.push(`changed again by another edit in the list; combine them into one: "${preview(edit.before)}"`);
      }
    }
  }
  for (const field of FIELDS) {
    if (text[field] !== (post[field] ?? "")) result.changed[field] = text[field];
  }
  return result;
}
