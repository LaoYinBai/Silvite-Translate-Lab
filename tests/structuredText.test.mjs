import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(async () => vite.close());

const { extractSubtitleText } = await vite.ssrLoadModule('/src/services/document/structuredText.ts');
const { parseDocumentFile } = await vite.ssrLoadModule('/src/services/document/fileParser.ts');

function fileOf(parts, name, type) {
  return new File(parts, name, { type });
}

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:00:03,600 --> 00:00:05,000
Second line
`;

const VTT = `WEBVTT
Kind: captions

NOTE this is a comment that must not be translated

STYLE
::cue { color: red }

cue-1
00:00:01.000 --> 00:00:03.500 align:start
Hello world

00:00:03.600 --> 00:00:05.000
Second line
`;

const ASS = `[Script Info]
Title: Example
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,Speaker A,0,0,0,,{\\i1}Hello{\\i0} world
Dialogue: 0,0:00:03.60,0:00:05.00,Default,,0,0,0,,Line one\\NLine two
`;

test('SRT keeps cue indices and timings so the result can be aligned back', () => {
  const text = extractSubtitleText(SRT, 'srt');
  assert.match(text, /00:00:01,000 --> 00:00:03,500/);
  assert.match(text, /Hello world/);
  assert.match(text, /Second line/);
});

test('VTT drops the header, NOTE and STYLE blocks but keeps the cues', () => {
  const text = extractSubtitleText(VTT, 'vtt');
  assert.doesNotMatch(text, /WEBVTT/);
  assert.doesNotMatch(text, /must not be translated/);
  assert.doesNotMatch(text, /::cue/);
  assert.doesNotMatch(text, /Kind: captions/);
  assert.match(text, /00:00:01\.000 --> 00:00:03\.500/);
  assert.match(text, /Hello world/);
  assert.match(text, /Second line/);
});

test('ASS keeps only dialogue text, without styles or override tags', () => {
  const text = extractSubtitleText(ASS, 'ass');
  assert.doesNotMatch(text, /\[Script Info\]/);
  assert.doesNotMatch(text, /Fontname/);
  assert.doesNotMatch(text, /\\i1/);
  assert.match(text, /Hello world/);
  assert.match(text, /Speaker A/);
  assert.match(text, /Line one\nLine two/, 'ASS line breaks become real newlines');
});

test('a subtitle file without cue structure falls back to plain text instead of failing', () => {
  assert.equal(extractSubtitleText('just some words', 'srt'), 'just some words');
  assert.equal(extractSubtitleText('a,b\n1,2', 'ass'), 'a,b\n1,2');
});

test('subtitle and CSV files are parsed as documents with their own label', async () => {
  const srt = await parseDocumentFile(fileOf([SRT], 'talk.srt', 'application/x-subrip'));
  assert.equal(srt.kind, 'srt');
  assert.match(srt.text, /Hello world/);

  const vtt = await parseDocumentFile(fileOf([VTT], 'talk.vtt', 'text/vtt'));
  assert.equal(vtt.kind, 'vtt');

  const ass = await parseDocumentFile(fileOf([ASS], 'talk.ass', ''));
  assert.equal(ass.kind, 'ass');

  const csv = await parseDocumentFile(fileOf(['name,note\nSilvite,translation'], 'rows.csv', 'text/csv'));
  assert.equal(csv.kind, 'csv');
  assert.match(csv.text, /Silvite,translation/);
});

test('a CSV reported as an Excel MIME still parses as CSV (Windows quirk)', async () => {
  const parsed = await parseDocumentFile(fileOf(['a,b\n1,2'], 'rows.csv', 'application/vnd.ms-excel'));
  assert.equal(parsed.kind, 'csv');
});
