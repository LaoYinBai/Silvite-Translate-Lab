// Subtitle formats carry a lot of machine data next to the actual lines.
// Sending it to the model wastes budget and invites it to "translate"
// style names, so only translatable payload is extracted here while cue
// indices and timings are kept for alignment.

export type StructuredTextFormat = 'srt' | 'vtt' | 'ass';

// VTT blocks that must never reach the model.
const VTT_SKIPPED_BLOCK = /^(WEBVTT|NOTE|STYLE|REGION)\b/i;

// ASS line breaks and inline override tags such as {\i1}.
const ASS_OVERRIDE_TAG = /\{[^}]*\}/g;
const ASS_LINE_BREAK = /\\[Nn]/g;

function extractVtt(text: string): string {
  const cues = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block && !VTT_SKIPPED_BLOCK.test(block));
  return cues.length ? cues.join('\n\n') : text.trim();
}

function extractAss(text: string): string {
  const dialogues = text.split('\n').filter((line) => /^Dialogue\s*:/i.test(line));
  if (!dialogues.length) return text.trim();
  return dialogues
    .map((line) => {
      // Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
      const fields = line.slice(line.indexOf(':') + 1).split(',');
      const start = fields[1]?.trim() ?? '';
      const end = fields[2]?.trim() ?? '';
      const speaker = fields[4]?.trim() ?? '';
      const body = fields
        .slice(9)
        .join(',')
        .replace(ASS_OVERRIDE_TAG, '')
        .replace(ASS_LINE_BREAK, '\n')
        .trim();
      if (!body) return '';
      const timing = start && end ? `${start} --> ${end}` : '';
      return [timing, speaker ? `${speaker}: ${body}` : body].filter(Boolean).join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Returns the translatable part of a subtitle file. A file that does not look
 * like the format it claims falls back to its own text rather than failing:
 * translating it as plain text is still better than refusing the file.
 */
export function extractSubtitleText(text: string, format: StructuredTextFormat): string {
  if (!text.trim()) return text;
  if (format === 'srt') return text.trim();
  if (format === 'vtt') return extractVtt(text);
  return extractAss(text);
}
