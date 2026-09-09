import { useEffect, useRef } from 'react';
import { useTranslationStore } from '../../store/translationStore';

// Pure-UI image lightbox. Reads previewImage from the store; never mutates
// input/result state. Closes via the button, the backdrop, or Escape.
export function Lightbox() {
  const previewImage = useTranslationStore((s) => s.previewImage);
  const closePreview = useTranslationStore((s) => s.closePreview);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!previewImage) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePreview();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewImage, closePreview]);

  if (!previewImage) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={closePreview}
      className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4"
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={closePreview}
        aria-label="关闭预览"
        className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/15 hover:bg-white/30 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      <img
        src={previewImage.src}
        alt={previewImage.alt}
        onClick={(event) => event.stopPropagation()}
        draggable={false}
        className="max-w-[92vw] max-h-[92vh] object-contain rounded-lg shadow-2xl select-none"
      />
    </div>
  );
}
