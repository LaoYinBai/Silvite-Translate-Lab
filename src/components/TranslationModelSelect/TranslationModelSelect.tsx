import type { TranslationModelId } from '../../api/client';

export function TranslationModelSelect({ value, onChange, disabled = false }: {
  value: TranslationModelId;
  onChange: (value: TranslationModelId) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-[#666666]">
      翻译模型
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as TranslationModelId)}
        disabled={disabled}
        className="min-h-11 max-w-full rounded-md border border-[#e0e0e0] bg-white px-3 text-[13px] text-[#222222] disabled:opacity-50"
      >
        <option value="deepseek">DeepSeek Flash</option>
        <option value="glm">GLM 5.3 Flash</option>
      </select>
    </label>
  );
}
