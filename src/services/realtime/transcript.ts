const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function normalizeForOverlap(value: string): string[] {
  return Array.from(value.toLocaleLowerCase().normalize('NFKC')).filter((char) => /[\p{L}\p{N}]/u.test(char));
}

function boundedEditDistance(left: string[], right: string[], maximum: number): number {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= right.length; j += 1) {
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      current[j] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[right.length];
}

/** Merge adjacent ASR windows deterministically, tolerating punctuation and modest rewrites. */
export function mergeTranscriptOverlap(previous: string, next: string): string {
  const left = previous.trim();
  const right = next.trim();
  if (!left) return right;
  if (!right) return left;
  const leftNormalized = normalizeForOverlap(left);
  const rightNormalized = normalizeForOverlap(right);
  if (!rightNormalized.length) return left;
  if (!leftNormalized.length) return right;

  const required = CJK.test(right) ? 2 : 4;
  const limit = Math.min(leftNormalized.length, rightNormalized.length, 80);
  let overlap = 0;
  for (let size = limit; size >= required; size -= 1) {
    let matched = true;
    for (let i = 0; i < size; i += 1) {
      if (leftNormalized[leftNormalized.length - size + i] !== rightNormalized[i]) { matched = false; break; }
    }
    if (matched) { overlap = size; break; }
  }

  // If punctuation-insensitive exact matching found only a tiny suffix, allow
  // one or two ASR character edits in a longer shared tail/prefix.
  let nextPrefixLength = overlap;
  const fuzzyMinimum = CJK.test(right) ? 8 : 12;
  if (limit >= fuzzyMinimum) {
    const rightLimit = Math.min(rightNormalized.length, 80);
    let best: { prefix: number; distance: number } | null = null;
    for (let prefix = rightLimit; prefix >= fuzzyMinimum; prefix -= 1) {
      for (let delta = -2; delta <= 2; delta += 1) {
        const tailLength = prefix + delta;
        if (tailLength < fuzzyMinimum || tailLength > Math.min(leftNormalized.length, 80)) continue;
        const maximumEdits = Math.max(1, Math.floor(prefix * 0.08));
        const leftTail = leftNormalized.slice(-tailLength);
        const rightPrefix = rightNormalized.slice(0, prefix);
        if (tailLength !== prefix && leftTail.slice(-2).join('') !== rightPrefix.slice(-2).join('')) continue;
        const distance = boundedEditDistance(
          leftTail,
          rightPrefix,
          maximumEdits,
        );
        if (distance <= maximumEdits && (!best || prefix > best.prefix || (prefix === best.prefix && distance < best.distance))) {
          best = { prefix, distance };
        }
      }
    }
    if (best && best.prefix > overlap) nextPrefixLength = best.prefix;
  }
  if (!overlap) {
    if (!nextPrefixLength) {
      const separator = /[\p{Script=Han}]$/u.test(left) || /^[\p{Script=Han}]/u.test(right) ? '' : ' ';
      return `${left}${separator}${right}`;
    }
  }

  // Map the normalized overlap length back to the original next-window boundary.
  let consumed = 0;
  let normalized = 0;
  while (consumed < right.length && normalized < nextPrefixLength) {
    if (/[\p{L}\p{N}]/u.test(right[consumed].normalize('NFKC'))) normalized += 1;
    consumed += 1;
  }
  const suffix = right.slice(consumed).trimStart();
  if (!suffix) return left;
  if (!normalizeForOverlap(suffix).length) {
    if (/[。！？.!?]$/u.test(left)) return left;
    return `${left}${suffix}`;
  }
  const separator = /[\p{Script=Han}]$/u.test(left) || /^[\p{Script=Han}]/u.test(suffix)
    || /^[,.;:!?)}\]}，。！？；：、]/u.test(suffix) ? '' : ' ';
  return `${left}${separator}${suffix}`;
}

export function detectRealtimeSourceLanguage(text: string): 'zh' | 'en' {
  let han = 0;
  let latin = 0;
  for (const char of text) {
    if (/\p{Script=Han}/u.test(char)) han += 1;
    else if (/[A-Za-z]/.test(char)) latin += 1;
  }
  return han >= latin * 0.35 ? 'zh' : 'en';
}

export function resolveRealtimeTarget(sourceLanguage: 'zh' | 'en', selected: 'auto' | 'zh' | 'en'): 'zh' | 'en' {
  return selected === 'auto' ? (sourceLanguage === 'zh' ? 'en' : 'zh') : selected;
}
