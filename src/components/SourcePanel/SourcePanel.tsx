import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslationStore } from '../../store/translationStore';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024;

export function SourcePanel() {
  const { 
    inputText, 
    setInputText, 
    inputImage, 
    setInputImage, 
    inputMode, 
    setInputMode,
    isLoading 
  } = useTranslationStore();
  
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<{
    fileName: string;
    fileSize: string;
  } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const processFile = useCallback(async (file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      setDragError('Unsupported format. Use JPG, PNG, or WebP.');
      setTimeout(() => setDragError(null), 3000);
      return;
    }
    
    if (file.size > MAX_SIZE) {
      setDragError('File too large. Maximum 10MB.');
      setTimeout(() => setDragError(null), 3000);
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setInputImage(base64);
      setInputMode('image');
      setImagePreview({
        fileName: file.name,
        fileSize: formatFileSize(file.size)
      });
    };
    reader.readAsDataURL(file);
  }, [setInputImage, setInputMode]);
  
  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  
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
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
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
    setImagePreview(null);
    setInputMode('text');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [setInputImage, setInputMode]);
  
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (inputMode === 'image' && e.target.value.length > 0) {
      setInputMode('text');
    }
  }, [setInputText, setInputMode]);
  
  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="h-9 flex items-center justify-between px-4 bg-[#f6f8fa] border-b border-[#e1e4e8]">
        <span className="text-[11px] font-semibold text-[#656d76] uppercase tracking-[0.04em]">
          Source
        </span>
        
        {/* Segmented control */}
        <div className="flex items-center bg-[#e1e4e8] rounded-sm p-[2px]">
          <button
            onClick={() => setInputMode('text')}
            className={`px-2.5 py-0.5 text-[11px] font-medium rounded-sm transition-all ${
              inputMode === 'text' 
                ? 'bg-white text-[#1f2328] shadow-sm' 
                : 'text-[#656d76] hover:text-[#1f2328]'
            }`}
          >
            Text
          </button>
          <button
            onClick={() => setInputMode('image')}
            className={`px-2.5 py-0.5 text-[11px] font-medium rounded-sm transition-all ${
              inputMode === 'image' 
                ? 'bg-white text-[#1f2328] shadow-sm' 
                : 'text-[#656d76] hover:text-[#1f2328]'
            }`}
          >
            Image
          </button>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        {inputMode === 'text' ? (
          <div className="h-full flex flex-col">
            <textarea
              value={inputText}
              onChange={handleTextChange}
              placeholder="输入中文或英文文本，或粘贴图片..."
              disabled={isLoading}
              className="flex-1 resize-none border-none outline-none p-4 text-[13px] leading-[1.6] bg-transparent text-[#1f2328] placeholder:text-[#afb8c1]"
            />
            {inputText && (
              <div className="h-7 flex items-center justify-between px-4 bg-[#f6f8fa] border-t border-[#e1e4e8]">
                <span className="text-[11px] text-[#8b949e]">
                  {inputText.length} characters
                </span>
                <button
                  onClick={() => setInputText('')}
                  className="text-[11px] text-[#8b949e] hover:text-[#d1242f] transition-colors"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        ) : (
          <div 
            className={`h-full flex flex-col items-center justify-center p-6 transition-colors ${
              isDragOver 
                ? 'bg-[#ddf4ff] border-2 border-dashed border-[#0969da]' 
                : inputImage 
                  ? 'bg-white' 
                  : 'bg-[#f6f8fa]'
            }`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {inputImage ? (
              <div className="w-full h-full flex flex-col">
                <div className="flex items-center justify-between mb-2 px-1">
                  <div className="flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#1a7f37]">
                      <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm3.22 4.97a.75.75 0 00-1.06-1.06L7 8.06 5.84 6.91a.75.75 0 10-1.06 1.06l1.62 1.62a.75.75 0 001.06 0l3.76-3.62z" fill="currentColor"/>
                    </svg>
                    <span className="text-[12px] text-[#1f2328] font-medium">
                      {imagePreview?.fileName}
                    </span>
                    <span className="text-[11px] text-[#8b949e]">
                      {imagePreview?.fileSize}
                    </span>
                  </div>
                  <button
                    onClick={clearImage}
                    className="text-[11px] text-[#8b949e] hover:text-[#d1242f] transition-colors"
                  >
                    Remove
                  </button>
                </div>
                <div className="flex-1 flex items-center justify-center overflow-hidden rounded-sm border border-[#e1e4e8] bg-[#f6f8fa]">
                  <img 
                    src={inputImage} 
                    alt="Preview" 
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
                <div className="h-7 flex items-center justify-center mt-2">
                  <span className="text-[11px] text-[#8b949e]">
                    Press Enter or click Translate to process
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className={`w-12 h-12 rounded-sm flex items-center justify-center mb-3 ${
                  isDragOver ? 'bg-[#0969da]' : 'bg-[#e1e4e8]'
                }`}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className={isDragOver ? 'text-white' : 'text-[#8b949e]'}>
                    <path d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                
                <p className="text-[13px] font-medium text-[#1f2328] mb-1">
                  {isDragOver ? 'Release to upload' : 'Drop image here'}
                </p>
                <p className="text-[12px] text-[#8b949e] mb-4">
                  or{' '}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-[#0969da] hover:underline"
                  >
                    browse files
                  </button>
                  {' '}· Paste from clipboard with <kbd className="px-1 py-0.5 text-[10px] bg-[#e1e4e8] rounded-sm font-mono">Ctrl+V</kbd>
                </p>
                <p className="text-[11px] text-[#afb8c1]">
                  JPG, PNG, WebP · Max 10MB
                </p>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </>
            )}
            
            {dragError && (
              <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2 p-2.5 bg-[#ffebe9] border border-[#d1242f] rounded-sm">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#d1242f] flex-shrink-0">
                  <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm-.75 3.75a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5zm.75 6.25a.75.75 0 100-1.5.75.75 0 000 1.5z" fill="currentColor"/>
                </svg>
                <span className="text-[12px] text-[#d1242f]">{dragError}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
