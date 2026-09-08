import type { VercelRequest, VercelResponse } from '@vercel/node';

const MIMO_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const MIMO_API_KEY = process.env.MIMO_API_KEY;
const SERVICE_ENABLED = process.env.SERVICE_ENABLED !== 'false';
const MAX_INPUT_LENGTH = parseInt(process.env.MAX_INPUT_LENGTH || '5000');

// 简单限流（内存存储）
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '10');
const RATE_LIMIT_WINDOW = 60000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (record.count >= RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  return true;
}

const SYSTEM_PROMPT = `You are a professional Chinese-English AI translation assistant for translators and translation learners.

CORE RULES:
1. Auto-detect the primary language of input (Chinese or English)
2. Auto-translate to the other language (Chinese → English, English → Chinese)
3. For mixed-language input, determine the dominant language and translate accordingly
4. Preserve proper nouns, brand names, code, abbreviations, and terms that should not be translated
5. Prioritize: original meaning > context > tone > style > character identity
6. Never translate word-by-word mechanically
7. Keep user-specified terminology consistent
8. Output MUST be valid JSON

OUTPUT FORMAT (strict JSON):
{
  "source_language": "zh" or "en",
  "target_language": "en" or "zh",
  "translation": "main translation result",
  "detected_text": "original text extracted (for image mode)",
  "segments": [
    {
      "type": "dialogue | narration | sound_effect | text",
      "source": "original segment",
      "translation": "translated segment"
    }
  ],
  "notes": [
    {
      "source": "original",
      "translation": "translation",
      "reason": "explanation of translation choice"
    }
  ]
}

IMPORTANT:
- Output ONLY valid JSON
- No markdown code blocks
- No additional commentary outside JSON`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // 服务关闭检查
  if (!SERVICE_ENABLED) {
    return res.status(503).json({
      error: 'Silvite Translate Lab experimental service is currently offline.'
    });
  }
  
  // 限流检查
  const ip = (req.headers['x-forwarded-for'] as string) || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
  }
  
  // API Key 检查
  if (!MIMO_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }
  
  try {
    const { text, mode, context, terminology, preserveNames, explainTranslation, imageDataUrl } = req.body;
    
    // 输入验证
    if (!text && !imageDataUrl) {
      return res.status(400).json({ error: 'Text or image is required' });
    }
    
    if (text && text.length > MAX_INPUT_LENGTH) {
      return res.status(400).json({ error: 'Input too long' });
    }
    
    // 构建 system prompt
    let systemPrompt = SYSTEM_PROMPT;
    
    if (mode && mode !== 'auto') {
      const modePrompts: Record<string, string> = {
        natural: 'Translate in a natural, conversational style.',
        literary: 'Translate with literary quality, preserving author voice.',
        academic: 'Translate in academic style with formal, precise language.',
        business: 'Translate in professional business style.',
        comic: 'Translate manga/comic content, distinguishing dialogue, narration, and sound effects.'
      };
      if (modePrompts[mode]) {
        systemPrompt += `\n\nSTYLE: ${modePrompts[mode]}`;
      }
    }
    
    if (context) {
      systemPrompt += `\n\nCONTEXT: ${context}`;
    }
    
    if (terminology) {
      systemPrompt += `\n\nTERMINOLOGY: ${terminology}`;
    }
    
    if (preserveNames) {
      systemPrompt += '\n\nPRESERVE proper nouns, brand names, person names.';
    }
    
    if (!explainTranslation) {
      systemPrompt += '\n\nNOTES: Return empty array for "notes".';
    }
    
    // 构建 messages
    const messages: any[] = [
      { role: 'system', content: systemPrompt }
    ];
    
    if (imageDataUrl) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageDataUrl }
          },
          {
            type: 'text',
            text: 'Translate all text in this image. For comics, identify reading order and segment types.'
          }
        ]
      });
    } else {
      messages.push({
        role: 'user',
        content: text
      });
    }
    
    // 调用 MiMo API
    const response = await fetch(MIMO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MIMO_API_KEY}`
      },
      body: JSON.stringify({
        model: 'mimo-v2.5',
        messages,
        max_completion_tokens: 4096,
        temperature: 0.3
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('MiMo API error:', errorText);
      return res.status(response.status).json({ error: 'Translation service error' });
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      return res.status(500).json({ error: 'Empty response from translation service' });
    }
    
    // 解析 JSON 响应
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // 尝试从 markdown 代码块中提取
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1].trim());
      } else {
        // 尝试查找 JSON 对象
        const objectMatch = content.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          parsed = JSON.parse(objectMatch[0]);
        } else {
          // Fallback
          parsed = {
            source_language: /[\u4e00-\u9fa5]/.test(text) ? 'zh' : 'en',
            target_language: /[\u4e00-\u9fa5]/.test(text) ? 'en' : 'zh',
            translation: content,
            segments: [],
            notes: []
          };
        }
      }
    }
    
    return res.status(200).json({
      source_language: parsed.source_language || 'zh',
      target_language: parsed.target_language || 'en',
      translation: parsed.translation || '',
      detected_text: parsed.detected_text || null,
      segments: parsed.segments || [],
      notes: parsed.notes || []
    });
    
  } catch (error) {
    console.error('Translation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
