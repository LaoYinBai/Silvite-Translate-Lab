import type { DocumentFileKind } from './fileParser';
import { documentKindOf, documentKindOfMimeType, SUPPORTED_DOCUMENT_ACCEPT } from './fileParser';
import { documentKindsLabel } from './formatLabels';

export type IncomingFileKind = 'image' | 'document' | 'unknown';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const IMAGE_EXTENSION_SET = new Set(IMAGE_EXTENSIONS);
const IMAGE_MIME_TYPE_SET = new Set(IMAGE_MIME_TYPES);

export const SUPPORTED_IMAGE_LABEL = 'JPG / PNG / WebP';
// Extensions plus MIME types, matching how the document registry is exposed:
// some platforms filter the picker by MIME rather than by extension.
export const SUPPORTED_IMAGE_ACCEPT = [
  ...IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
  ...IMAGE_MIME_TYPES,
].join(',');

// One picker for everything the app can really handle. Only formats with a
// working parser appear here.
export const SUPPORTED_INPUT_ACCEPT = [SUPPORTED_IMAGE_ACCEPT, SUPPORTED_DOCUMENT_ACCEPT].join(',');

export interface IncomingFileMeta {
  name: string;
  type: string;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index === -1 ? '' : name.slice(index + 1).toLowerCase();
}

export function isSupportedImageFile(file: IncomingFileMeta): boolean {
  const mimeType = (file.type || '').toLowerCase();
  return IMAGE_EXTENSION_SET.has(extensionOf(file.name)) || IMAGE_MIME_TYPE_SET.has(mimeType);
}

export function unsupportedFileMessage(kinds: DocumentFileKind[]): string {
  return `不支持的文件格式，请使用 ${documentKindsLabel(kinds)} 文件或 ${SUPPORTED_IMAGE_LABEL} 图片`;
}

/**
 * Decides which pipeline an incoming file belongs to. Routing must follow the
 * file itself: a PDF dropped while the text tab is active is still a document.
 *
 * A document extension wins over a conflicting image MIME so the document
 * parser (which verifies MIME, signature and parse result) owns the verdict
 * instead of the image pipeline rejecting it with a misleading message.
 */
export function classifyIncomingFile(file: IncomingFileMeta): IncomingFileKind {
  if (documentKindOf(file.name)) return 'document';
  if (isSupportedImageFile(file)) return 'image';
  if (documentKindOfMimeType(file.type)) return 'document';
  return 'unknown';
}
