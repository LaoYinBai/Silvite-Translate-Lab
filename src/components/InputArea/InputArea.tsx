import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslationStore, type TranslationMode } from '../../store/translationStore';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024;
// EdgeOne edge functions accept request bodies up to ~1MB. Keep the
// serialized data URL safely below that; larger images are re-encoded.
const MAX_DATA_URL_LENGTH = 700_000;
const RAW_IMAGE_LIMIT = 500 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解析失败'));
    img.src = src;
  });
}

async function compressToDataUrl(file: File): Promise<string> {
  const original = await readAsDataUrl(file);
  if (file.size <= RAW_IMAGE_LIMIT) return original;

  const img = await loadImageElement(original);
  const maxEdge = 2000;
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return original;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > MAX_DATA_URL_LENGTH && quality > 0.5) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  return dataUrl.length <= original.length ? dataUrl : original;
}

const MODE_OPTIONS: Array<{ value: TranslationMode; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'natural', label: '自然' },
  { value: 'literary', label: '文学' },
  { value: 'academic', label: '学术' },
  { value: 'business', label: '商务' },
  { value: 'comic', label: '漫画' },
];

export function InputArea() {
  const { 
    inputText, 
    setInputText, 
    inputImage, 
    setInputImage, 
    inputMode, 
    setInputMode,
    mode,
    setMode,
    isLoading 
  } = useTranslationStore();
  
  const [isDragOver, setIsDragOver] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const processFile = useCallback(async (file: File) => {
    setImageError(null);
    if (!ALLOWED_TYPES.includes(file.type)) {
      setImageError('不支持的文件格式，请使用 JPG、PNG 或 WebP 图片');
      return;
    }
    if (file.size > MAX_SIZE) {
      setImageError('图片过大，最大支持 10MB');
      return;
    }
    
    try {
      const base64 = await compressToDataUrl(file);
      setInputImage(base64);
      setInputMode('image');
    } catch (err) {
      setImageError(err instanceof Error ? err.message : '图片处理失败');
    }
  }, [setInputImage, setInputMode]);
  
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      setIsDragOver(false);
    }
  }, []);
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFile(files[0]);
    }
  }, [processFile]);
  
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  }, [processFile]);
  
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processFile(file);
            break;
          }
        }
      }
    };
    
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [processFile]);
  
  const clearImage = useCallback(() => {
    setInputImage(null);
    setInputMode('text');
  }, [setInputImage, setInputMode]);
  
  const handleTranslate = useCallback(() => {
    if (!inputText.trim() && !inputImage) return;
    useTranslationStore.getState().translate();
  }, [inputText, inputImage]);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTranslate();
    }
  }, [handleTranslate]);
  
  const handleClear = useCallback(() => {
    setInputText('');
    setInputImage(null);
  }, [setInputText, setInputImage]);
  
  return (
    <div className="w-full">
      {/* Input container */}
      <div 
        className={`relative bg-white rounded-xl transition-all duration-200 ${
          isDragOver 
            ? 'ring-2 ring-[#1677ff] shadow-lg' 
            : 'border border-[#e0e0e0] hover:border-[#d0d0d0] shadow-sm'
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Image preview */}
        {inputImage && (
          <div className="p-5 pb-0">
            <div className="relative inline-block">
              <img 
                src={inputImage} 
                alt="已上传图片" 
                className="h-28 rounded-lg object-cover border border-[#e0e0e0]"
              />
              <button
                onClick={clearImage}
                className="absolute -top-2 -right-2 w-7 h-7 bg-[#666666] hover:bg-[#ff4d4f] text-white rounded-full flex items-center justify-center transition-colors"
                title="移除图片"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          </div>
        )}
        
        {/* Textarea */}
        <div className="p-6 pb-4">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入要翻译的文本，或拖拽图片到此区域..."
            disabled={isLoading}
            rows={5}
            className="w-full resize-none border-none outline-none text-[17px] leading-[1.8] text-[#1a1a1a] placeholder:text-[#b0b0b0] bg-transparent min-h-[180px]"
          />
        </div>
        
        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-[#f0f0f0]">
          {/* Left: Input type & Language direction */}
          <div className="flex items-center gap-4">
            {/* Input type segmented control */}
            <div className="segmented-control">
              <button
                onClick={() => setInputMode('text')}
                className={`segmented-control-item ${inputMode === 'text' ? 'active' : ''}`}
              >
                文本
              </button>
              <button
                onClick={() => setInputMode('image')}
                className={`segmented-control-item ${inputMode === 'image' ? 'active' : ''}`}
              >
                图片
              </button>
            </div>
            
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              onChange={handleFileSelect}
              className="hidden"
            />
            
            {/* Divider */}
            <div className="w-px h-6 bg-[#e0e0e0]" />
            
            {/* Translation mode segmented control */}
            <div className="segmented-control" role="group" aria-label="翻译模式">
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMode(option.value)}
                  aria-pressed={mode === option.value}
                  className={`segmented-control-item ${mode === option.value ? 'active' : ''}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            
            {/* Divider */}
            <div className="w-px h-6 bg-[#e0e0e0]" />
            
            {/* Clear button */}
            <button
              onClick={handleClear}
              disabled={!inputText && !inputImage}
              className="btn btn-ghost h-[36px] px-3"
            >
              清空
            </button>
          </div>
          
          {/* Right: Translate button */}
          <button
            onClick={handleTranslate}
            disabled={(!inputText.trim() && !inputImage) || isLoading}
            className="btn btn-primary"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                翻译中…
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                  <path d="M14 2L7 9M14 2l-4 12-3-5-5-3 12-4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                翻译
              </>
            )}
          </button>
        </div>
      </div>
      
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-[#1677ff] bg-opacity-5 rounded-xl flex items-center justify-center pointer-events-none z-10">
          <div className="bg-white rounded-xl px-8 py-5 shadow-lg">
            <p className="text-[16px] font-medium text-[#1677ff]">松开即可上传图片</p>
          </div>
        </div>
      )}
      
      {/* Image validation / processing error */}
      {imageError && (
        <div role="alert" className="mt-3 px-4 py-3 bg-[#fff2f0] border border-[#ff4d4f] rounded-lg flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[#ff4d4f] flex-shrink-0" aria-hidden="true">
            <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm-.75 3.75a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5zm.75 6.25a.75.75 0 100-1.5.75.75 0 000 1.5z" fill="currentColor"/>
          </svg>
          <span className="text-[13px] text-[#ff4d4f]">{imageError}</span>
          <button
            type="button"
            onClick={() => setImageError(null)}
            aria-label="关闭提示"
            className="ml-auto text-[#ff4d4f] hover:text-[#d9363e]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
