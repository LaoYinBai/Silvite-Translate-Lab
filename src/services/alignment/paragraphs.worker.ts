import { alignParagraphs, type ParagraphAlignmentInput } from './paragraphs';

self.onmessage = ({ data }: MessageEvent<ParagraphAlignmentInput>) => {
  try {
    self.postMessage({ alignment: alignParagraphs(data) });
  } catch {
    self.postMessage({ error: '段落对照暂时不可用，可以继续查看完整译文。' });
  }
};
