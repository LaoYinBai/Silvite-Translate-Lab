import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslationStore, type TranslationMode } from '../../store/translationStore';
import { parseDocumentFile } from '../../services/document/fileParser';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024;
// EdgeOne edge functions accept request bodies up to ~1MB. Keep the
// serialized data URL safely below that; larger images are re-encoded.
const MAX_DATA_URL_LENGTH = 700_000;
const RAW_IMAGE_LIMIT = 500 * 1024;
// Mirrors the backend MAX_INPUT_LENGTH default (server remains the authority).
const MAX_INPUT_CHARS = 20000;

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

// Shared toolbar pieces. The mobile (stacked rows) and desktop (single row)
// toolbars keep their own container layout but render these same components;
// only size/width classes differ via the className prop.

function InputTypeToggle() {
  const { inputMode, setInputMode } = useTranslationStore();
  return (
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
      <button
        type="button"
        onClick={() => setInputMode('file')}
        className={`segmented-control-item ${inputMode === 'file' ? 'active' : ''}`}
      >
        文件
      </button>
    </div>
  );
}

function ModeTabs() {
  const { mode, setMode } = useTranslationStore();
  return (
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
  );
}

function AdvancedToggle({ showAdvanced, onToggle }: {
  showAdvanced: boolean;
  onToggle: () => void;
}) {
  const { context, terminology } = useTranslationStore();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={showAdvanced}
      className={`flex items-center gap-1.5 h-[36px] px-3 text-[13px] rounded-lg transition-colors ${
        showAdvanced
          ? 'bg-[#e6f4ff] text-[#1677ff] font-medium'
          : 'text-[#666666] hover:text-[#1a1a1a] hover:bg-[#f5f5f5]'
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.4"/>
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4"/>
      </svg>
      高级
      {(context || terminology) && !showAdvanced && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#1677ff]" aria-hidden="true" />
      )}
    </button>
  );
}

function ClearButton({ inputText, inputImage, hasDocument, onClear, className }: {
  inputText: string;
  inputImage: string | null;
  hasDocument: boolean;
  onClear: () => void;
  className: string;
}) {
  return (
    <button onClick={onClear} disabled={!inputText && !inputImage && !hasDocument} className={className}>
      清空
    </button>
  );
}

function TranslateButton({ className = '' }: { className?: string }) {
  const { inputText, inputImage, inputMode, documentFile, isLoading } = useTranslationStore();
  const overLimit = inputText.length > MAX_INPUT_CHARS;
  const hasInput = inputMode === 'file'
    ? Boolean(documentFile)
    : inputMode === 'image'
      ? Boolean(inputImage)
      : Boolean(inputText.trim()) && !overLimit;
  return (
    <button
      onClick={() => useTranslationStore.getState().translate()}
      disabled={!hasInput || isLoading}
      className={`btn btn-primary ${className}`}
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
  );
}

export function InputArea() {
  const { 
    inputText, 
    setInputText, 
    inputImage, 
    setInputImage, 
    inputMode, 
    setInputMode,
    imageSource,
    documentFile,
    fileStatus,
    fileError,
    setDocumentFile,
    setFileStatus,
    openPreview,
    context,
    setContext,
    terminology,
    setTerminology,
    preserveNames,
    setPreserveNames,
    isLoading 
  } = useTranslationStore();
  
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  
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

  const processDocument = useCallback(async (file: File) => {
    setFileStatus('parsing');
    try {
      const parsed = await parseDocumentFile(file);
      setDocumentFile(parsed);
      setInputMode('file');
    } catch (error) {
      setDocumentFile(null);
      setFileStatus('error', error instanceof Error ? error.message : '文件解析失败');
    }
  }, [setDocumentFile, setFileStatus, setInputMode]);
  
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
      if (inputMode === 'file') processDocument(files[0]);
      else processFile(files[0]);
    }
  }, [inputMode, processDocument, processFile]);
  
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  }, [processFile]);

  const handleDocumentSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processDocument(file);
    e.target.value = '';
  }, [processDocument]);
  
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
  
  // Removes the current user image but stays in image mode; the panel then
  // shows the add-image dropzone again. Demo images never get this button.
  const clearImage = useCallback(() => {
    setInputImage(null);
  }, [setInputImage]);

  const handleReplaceImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleChooseDocument = useCallback(() => {
    documentInputRef.current?.click();
  }, []);
  
  const handleTranslate = useCallback(() => {
    if (inputText.length > MAX_INPUT_CHARS) return;
    if (inputMode === 'file' && !documentFile) return;
    if (inputMode === 'image' && !inputImage) return;
    if (inputMode === 'text' && !inputText.trim()) return;
    useTranslationStore.getState().translate();
  }, [documentFile, inputMode, inputText, inputImage]);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTranslate();
    }
  }, [handleTranslate]);
  
  const handleClear = useCallback(() => {
    setInputText('');
    setInputImage(null);
    setDocumentFile(null);
  }, [setDocumentFile, setInputText, setInputImage]);

  const formatFileSize = (size: number) => size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
  
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
        {/* Image mode: fully replaces the text panel. The textarea is never
            rendered here. Demo images show preview only (no remove/replace). */}
        {inputMode === 'image' && !inputImage && (
          <div className="p-4 md:p-6">
            <button
              type="button"
              onClick={handleReplaceImage}
              className="w-full min-h-[180px] md:min-h-[220px] rounded-xl border-2 border-dashed border-[#d9d9d9] hover:border-[#1677ff] hover:bg-[#f7fbff] transition-colors flex flex-col items-center justify-center gap-2 text-center cursor-pointer"
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="#b0b0b0" strokeWidth="1.6"/>
                <circle cx="9" cy="10" r="1.6" stroke="#b0b0b0" strokeWidth="1.6"/>
                <path d="M3.5 16.5l4.5-4 3 2.5 4-3.5 5.5 5" stroke="#b0b0b0" strokeWidth="1.6" strokeLinejoin="round"/>
              </svg>
              <span className="text-[15px] font-medium text-[#555555]">
                <span className="hidden md:inline">拖入图片，或点击选择</span>
                <span className="md:hidden">添加图片</span>
              </span>
              <span className="text-[12px] text-[#999999]">JPG / PNG / WebP · 最大 10MB</span>
            </button>
          </div>
        )}

        {inputMode === 'image' && inputImage && (
          <div className="p-4 md:p-6">
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => openPreview(inputImage, imageSource === 'demo' ? '演示样本图片' : '已上传图片')}
                title="点击查看大图"
                className="group relative rounded-lg overflow-hidden border border-[#e0e0e0] hover:border-[#1677ff] transition-colors cursor-zoom-in"
              >
                <img
                  src={inputImage}
                  alt={imageSource === 'demo' ? '演示样本图片' : '已上传图片'}
                  className="max-h-[300px] md:max-h-[360px] max-w-full w-auto object-contain"
                  draggable={false}
                />
                <span className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md bg-black/55 text-white text-[11px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M7 5v4M5 7h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  查看大图
                </span>
              </button>

              {imageSource === 'demo' ? (
                <p className="text-[12px] text-[#999999]">演示样本图片 · 点击图片可放大预览</p>
              ) : (
                <div className="flex items-center gap-3">
                  <button type="button" onClick={handleReplaceImage} className="btn btn-secondary h-[36px]">
                    更换图片
                  </button>
                  <button type="button" onClick={clearImage} className="btn btn-ghost h-[36px]">
                    删除
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {inputMode === 'file' && (
          <div className="p-4 md:p-6">
            {!documentFile ? (
              <button
                type="button"
                onClick={handleChooseDocument}
                disabled={fileStatus === 'parsing' || isLoading}
                className="w-full min-h-[180px] md:min-h-[220px] rounded-xl border-2 border-dashed border-[#d9d9d9] hover:border-[#1677ff] hover:bg-[#f7fbff] transition-colors flex flex-col items-center justify-center gap-2 text-center disabled:cursor-wait disabled:opacity-70"
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M7 3h7l4 4v14H7a2 2 0 01-2-2V5a2 2 0 012-2z" stroke="#b0b0b0" strokeWidth="1.6"/>
                  <path d="M14 3v5h5M9 13h6M9 17h5" stroke="#b0b0b0" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
                <span className="text-[15px] font-medium text-[#555555]">
                  {fileStatus === 'parsing' ? '正在解析文件…' : '拖入文件，或点击选择'}
                </span>
                <span className="text-[12px] text-[#999999]">PDF / DOCX / TXT / MD · 最大 10MB</span>
              </button>
            ) : (
              <div className="min-h-[180px] md:min-h-[220px] flex items-center justify-center">
                <div className="w-full max-w-[560px] rounded-lg border border-[#e0e0e0] bg-[#fafafa] p-4 md:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-white border border-[#e0e0e0] flex items-center justify-center text-[12px] font-semibold text-[#1677ff] uppercase">
                      {documentFile.kind}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium text-[#1a1a1a] truncate">{documentFile.name}</p>
                      <p className="mt-1 text-[12px] text-[#888888]">
                        {documentFile.kind.toUpperCase()} · {formatFileSize(documentFile.size)} · 已提取 {documentFile.characterCount.toLocaleString()} 个字符
                      </p>
                      <p className="mt-2 text-[12px] text-[#52a246]">文件解析完成，可以开始翻译</p>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button type="button" onClick={handleChooseDocument} disabled={isLoading} className="btn btn-secondary h-[36px]">更换文件</button>
                    <button type="button" onClick={() => setDocumentFile(null)} disabled={isLoading} className="btn btn-ghost h-[36px]">删除</button>
                  </div>
                </div>
              </div>
            )}
            {fileError && <p className="mt-3 text-[13px] text-[#ff4d4f]">{fileError}</p>}
          </div>
        )}

        {/* Text mode: the classic textarea panel. Mutually exclusive with the
            image panels above. */}
        {inputMode === 'text' && (
          <div className="p-4 pb-4 md:p-6 md:pb-4">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入任意语言的文本。中文译为英文，其他语言自动译入中文..."
              disabled={isLoading}
              rows={5}
              className="w-full resize-none border-none outline-none text-[17px] leading-[1.8] text-[#1a1a1a] placeholder:text-[#b0b0b0] bg-transparent min-h-[140px] md:min-h-[180px]"
            />
            {inputText.length > 0 && (
              <div
                className={`text-right text-[12px] mt-1 ${
                  inputText.length > MAX_INPUT_CHARS ? 'text-[#ff4d4f]' : 'text-[#b0b0b0]'
                }`}
              >
                {inputText.length > MAX_INPUT_CHARS
                  ? `最多支持 20000 个字符（当前 ${inputText.length}）`
                  : `${inputText.length} / 20000`}
              </div>
            )}
          </div>
        )}
        
        {/* Hidden file input shared by both layouts */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          onChange={handleImageSelect}
          className="hidden"
        />
        <input
          ref={documentInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          onChange={handleDocumentSelect}
          className="hidden"
        />

        {/* Bottom toolbar — mobile gets its own stacked layout; desktop keeps
            the single row. The two layouts share all handlers and state. */}
        <div className="border-t border-[#f0f0f0] min-w-0">
          {/* Mobile layout: Row1 type/advanced, Row2 scrollable modes,
              Row3 clear + translate */}
          <div className="md:hidden min-w-0">
            <div className="flex items-center justify-between gap-2 px-4 pt-3">
              <InputTypeToggle />

              <AdvancedToggle
                showAdvanced={showAdvanced}
                onToggle={() => setShowAdvanced(!showAdvanced)}
              />
            </div>

            {/* Mode row: horizontal scroll only; items never wrap */}
            <div className="overflow-x-auto overflow-y-hidden scrollbar-hide min-w-0 mt-2">
              <div className="flex w-max px-4">
                <ModeTabs />
              </div>
            </div>

            <div className="flex items-center gap-2 px-4 py-3">
              <ClearButton
                inputText={inputText}
                inputImage={inputImage}
                hasDocument={Boolean(documentFile)}
                onClear={handleClear}
                className="btn btn-ghost h-11 px-3"
              />
              <TranslateButton className="flex-1 h-11" />
            </div>
          </div>

          {/* Desktop layout: unchanged single row */}
          <div className="hidden md:flex items-center justify-between px-5 py-4 min-w-0">
            {/* Left: Input type & Language direction */}
            <div className="flex items-center gap-4">
              <InputTypeToggle />

              {/* Divider */}
              <div className="w-px h-6 bg-[#e0e0e0]" />

              <ModeTabs />

              {/* Divider */}
              <div className="w-px h-6 bg-[#e0e0e0]" />

              <ClearButton
                inputText={inputText}
                inputImage={inputImage}
                hasDocument={Boolean(documentFile)}
                onClear={handleClear}
                className="btn btn-ghost h-[36px] px-3"
              />
              <AdvancedToggle
                showAdvanced={showAdvanced}
                onToggle={() => setShowAdvanced(!showAdvanced)}
              />
            </div>

            {/* Right: Translate button */}
            <TranslateButton />
          </div>
        </div>
        
        {/* Advanced panel: context & terminology constraints */}
        {showAdvanced && (
          <div className="px-4 pb-4 md:px-5 border-t border-[#f0f0f0] pt-4 bg-[#fafafa] rounded-b-xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="context-input" className="block text-[12px] font-medium text-[#555555] mb-1.5">
                  上下文 / Context
                </label>
                <textarea
                  id="context-input"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="告诉模型这段文字的场景，例：这是科技产品官网文案"
                  rows={2}
                  className="w-full px-3 py-2 text-[13px] leading-[1.6] bg-white border border-[#e0e0e0] rounded-lg outline-none focus:border-[#1677ff] transition-colors placeholder:text-[#b0b0b0] resize-none"
                />
              </div>
              
              <div>
                <label htmlFor="terminology-input" className="block text-[12px] font-medium text-[#555555] mb-1.5">
                  术语 / Terminology
                </label>
                <textarea
                  id="terminology-input"
                  value={terminology}
                  onChange={(e) => setTerminology(e.target.value)}
                  placeholder={'每行一条，例：\n沈理 -> Shenyang Ligong University\nMoDi Connect -> 保持原样'}
                  rows={2}
                  className="w-full px-3 py-2 text-[13px] leading-[1.6] bg-white border border-[#e0e0e0] rounded-lg outline-none focus:border-[#1677ff] transition-colors placeholder:text-[#b0b0b0] resize-none"
                />
              </div>
            </div>
            
            <label className="mt-3 inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={preserveNames}
                onChange={(e) => setPreserveNames(e.target.checked)}
                className="w-4 h-4 rounded border-[#d0d0d0] text-[#1677ff] focus:ring-[#1677ff] cursor-pointer"
              />
              <span className="text-[13px] text-[#555555]">保留专有名词、品牌名与人名</span>
            </label>
          </div>
        )}
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
