import { create } from 'zustand';
import { translate as apiTranslate } from '../api/client';

export type TranslationMode = 
  | 'auto'
  | 'natural'
  | 'literary'
  | 'academic'
  | 'business'
  | 'comic';

export type InputMode = 'text' | 'image';

export interface TranslationSegment {
  type: 'dialogue' | 'narration' | 'sound_effect' | 'text';
  source: string;
  translation: string;
}

export interface TranslationNote {
  source: string;
  translation: string;
  reason: string;
}

export interface TranslationResult {
  sourceLanguage: 'zh' | 'en';
  targetLanguage: 'en' | 'zh';
  translation: string;
  detectedText?: string;
  segments: TranslationSegment[];
  notes: TranslationNote[];
}

interface TranslationState {
  // Input
  inputText: string;
  inputImage: string | null;
  inputMode: InputMode;
  
  // Settings
  mode: TranslationMode;
  context: string;
  terminology: string;
  preserveNames: boolean;
  explainTranslation: boolean;
  
  // Result
  result: TranslationResult | null;
  isLoading: boolean;
  error: string | null;
  
  // Service status
  isServiceOnline: boolean;
  
  // Actions
  setInputText: (text: string) => void;
  setInputImage: (image: string | null) => void;
  setInputMode: (mode: InputMode) => void;
  setMode: (mode: TranslationMode) => void;
  setContext: (context: string) => void;
  setTerminology: (terminology: string) => void;
  setPreserveNames: (preserve: boolean) => void;
  setExplainTranslation: (explain: boolean) => void;
  setResult: (result: TranslationResult | null) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setServiceOnline: (online: boolean) => void;
  translate: () => Promise<void>;
  reset: () => void;
}

export const useTranslationStore = create<TranslationState>((set, get) => ({
  inputText: '',
  inputImage: null,
  inputMode: 'text',
  
  mode: 'auto',
  context: '',
  terminology: '',
  preserveNames: true,
  explainTranslation: false,
  
  result: null,
  isLoading: false,
  error: null,
  isServiceOnline: true,
  
  setInputText: (text) => set({ inputText: text }),
  setInputImage: (image) => set({ inputImage: image }),
  setInputMode: (mode) => set({ inputMode: mode }),
  setMode: (mode) => set({ mode }),
  setContext: (context) => set({ context }),
  setTerminology: (terminology) => set({ terminology }),
  setPreserveNames: (preserve) => set({ preserveNames: preserve }),
  setExplainTranslation: (explain) => set({ explainTranslation: explain }),
  setResult: (result) => set({ result }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setServiceOnline: (online) => set({ isServiceOnline: online }),
  
  translate: async () => {
    const state = get();
    if (!state.inputText.trim() && !state.inputImage) return;
    
    set({ isLoading: true, error: null });
    
    try {
      const response = await apiTranslate({
        text: state.inputText || undefined,
        imageDataUrl: state.inputImage || undefined,
        mode: state.mode,
        context: state.context || undefined,
        terminology: state.terminology || undefined,
        preserveNames: state.preserveNames,
        explainTranslation: state.explainTranslation
      });
      
      set({
        result: {
          sourceLanguage: response.source_language,
          targetLanguage: response.target_language,
          translation: response.translation,
          detectedText: response.detected_text,
          segments: (response.segments || []).map(s => ({
            ...s,
            type: s.type as 'dialogue' | 'narration' | 'sound_effect' | 'text'
          })),
          notes: response.notes || []
        },
        isLoading: false
      });
    } catch {
      // Fallback to demo mode
      const isChinese = /[\u4e00-\u9fa5]/.test(state.inputText);
      set({
        result: {
          sourceLanguage: isChinese ? 'zh' : 'en',
          targetLanguage: isChinese ? 'en' : 'zh',
          translation: state.inputText + '\n\n[演示模式——请配置 API 以使用真实翻译]',
          segments: [],
          notes: []
        },
        isLoading: false,
        error: null
      });
    }
  },
  
  reset: () => set({
    inputText: '',
    inputImage: null,
    result: null,
    error: null
  })
}));
