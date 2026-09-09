import type { ReactNode } from 'react';
import type { DemoIcon, DemoSample } from '../../demo/samples';
import { useTranslationStore } from '../../store/translationStore';

const ICONS: Record<DemoIcon, ReactNode> = {
  message: (
    <path d="M2.5 4.5a2 2 0 012-2h7a2 2 0 012 2v5a2 2 0 01-2 2H6.5L3.5 14v-2.5h-.5a2 2 0 01-.5-.05" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  ),
  layers: (
    <>
      <path d="M8 1.8l5.8 2.9L8 7.6 2.2 4.7z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M2.2 8.2L8 11.1l5.8-2.9M2.2 11.4L8 14.3l5.8-2.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  tag: (
    <>
      <path d="M2 2.5h5.2L14 9.2a1.6 1.6 0 010 2.3l-2.5 2.5a1.6 1.6 0 01-2.3 0L2 7.2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="5.2" cy="5.2" r="1.1" fill="currentColor" />
    </>
  ),
  cap: (
    <>
      <path d="M8 2.2l6.5 2.7L8 7.6 1.5 4.9z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M4.3 6.4v3.1c0 .9 1.7 1.7 3.7 1.7s3.7-.8 3.7-1.7V6.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M14.5 5.2v3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  briefcase: (
    <>
      <rect x="1.8" y="5" width="12.4" height="8.2" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.8 5V3.6c0-.6.5-1.1 1.1-1.1h2.2c.6 0 1.1.5 1.1 1.1V5M1.8 8.6h12.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  book: (
    <>
      <path d="M8 3.6C6.6 2.4 4.2 2.1 2.2 2.6v10.2c2-.5 4.4-.2 5.8 1 1.4-1.2 3.8-1.5 5.8-1V2.6c-2-.5-4.4-.2-5.8 1z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 3.6v10.2" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  shield: (
    <path d="M8 1.6l5.2 2.1v4.2c0 3.1-2.1 5.6-5.2 6.9-3.1-1.3-5.2-3.8-5.2-6.9V3.7z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="5.9" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <ellipse cx="8" cy="8" rx="2.5" ry="5.9" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.2 8h11.6M3 5h10M3 11h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </>
  ),
  image: (
    <>
      <rect x="1.8" y="3" width="12.4" height="10" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5.6" cy="6.4" r="1.2" fill="currentColor" />
      <path d="M2.5 11.5l3.2-3.4 2.4 2.5 2.2-2.2 3.2 3.1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  speech: (
    <>
      <path d="M1.8 3.5h8.4v5H5.6L3 11v-2.5h-1.2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11.8 6.2h2.4v4.6h-1.2v2l-2.4-2H7.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </>
  ),
};

export function DemoSampleList({ samples, onPicked }: { samples: DemoSample[]; onPicked?: () => void }) {
  return (
    <div className="space-y-1">
      {samples.map((sample, index) => (
        <button
          key={sample.id}
          onClick={() => {
            void useTranslationStore.getState().loadDemoSample(index);
            onPicked?.();
          }}
          className="w-full flex items-start gap-3 px-3 py-2 rounded-lg text-left text-[#1a1a1a] hover:bg-[#eaecef] transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" className="mt-0.5 flex-shrink-0 text-[#555555]" aria-hidden="true">
            {ICONS[sample.icon]}
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-medium truncate">{sample.title}</p>
            <p className="text-[12px] text-[#888888] mt-0.5 truncate">{sample.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
