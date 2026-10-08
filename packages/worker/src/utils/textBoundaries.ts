/** A boundary is a UTF-16 offset, never a code-point index. */
export function isTextBoundary(text: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length)
    return false;
  if (offset === 0 || offset === text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return (
    !(
      before >= 0xd800 &&
      before <= 0xdbff &&
      after >= 0xdc00 &&
      after <= 0xdfff
    ) && !(before === 13 && after === 10)
  );
}

/** CRLF and valid surrogate pairs are indivisible; lone surrogates are preserved. */
export function nextTextBoundary(text: string, offset: number): number {
  const first = text.charCodeAt(offset);
  const second = text.charCodeAt(offset + 1);
  return (
    offset +
    ((first === 13 && second === 10) ||
    (first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff)
      ? 2
      : 1)
  );
}
