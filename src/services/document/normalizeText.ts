// PDF text layers frequently map a glyph to a radical code point instead of the
// ideograph it depicts: real files extract as "倒数⽇ CountdownApp" or "⻓期"
// rather than "倒数日"/"长期". Those code points are a font artifact, not author
// intent, and they were previously sent to the model verbatim.
//
// Normalization is deliberately narrow. A blanket NFKC pass also rewrites
// legitimate source characters (① → 1, ㎏ → kg, ⅓ → 1⁄3, ！ → !), which would
// corrupt text the user actually meant. Only two things happen here:
//   1. NFC — canonical equivalence, which folds CJK compatibility ideographs;
//   2. Radical folding — Kangxi radicals via their compatibility decomposition,
//      plus an explicit table for CJK Radicals Supplement, which has none.

const KANGXI_RADICAL = /[\u2F00-\u2FD5]/;

// CJK Radicals Supplement characters have no compatibility decomposition, so
// they cannot be folded algorithmically. Only mappings observed in real
// extracted documents are listed — a wrong entry would silently corrupt text,
// so an unmapped radical is passed through untouched instead of guessed.
const RADICAL_SUPPLEMENT: Record<string, string> = {
  '\u2EC5': '见',
  '\u2ED3': '长',
  '\u2ED4': '门',
  '\u2EDA': '页',
  '\u2EDB': '风',
  '\u2EE2': '马',
  '\u2EE3': '骨',
  '\u2EE8': '麦',
  '\u2EE9': '黄',
};

const RADICAL_SUPPLEMENT_PATTERN = new RegExp(`[${Object.keys(RADICAL_SUPPLEMENT).join('')}]`);

export function normalizeExtractedText(text: string): string {
  if (!text) return '';
  const canonical = text.normalize('NFC');
  if (!KANGXI_RADICAL.test(canonical) && !RADICAL_SUPPLEMENT_PATTERN.test(canonical)) return canonical;

  let result = '';
  for (const char of canonical) {
    if (KANGXI_RADICAL.test(char)) {
      result += char.normalize('NFKC');
    } else {
      result += RADICAL_SUPPLEMENT[char] ?? char;
    }
  }
  return result;
}
