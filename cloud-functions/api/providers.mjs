// Shared by document/image translation and realtime subtitle translation.
// Credentials and endpoints are read only from server environment variables.
export const DEFAULT_PROVIDER_ID = 'mimo';

const PROVIDER_DEFINITIONS = {
  mimo: {
    id: 'mimo',
    label: 'MiMo V2.6 Flash',
    url: 'https://api.xiaomimimo.com/v1/chat/completions',
    apiKeyEnv: 'MIMO_API_KEY',
    defaultModel: 'mimo-v2.6-flash',
    budgetParam: 'max_completion_tokens',
    maxCompletionTokens: 65536,
    hardTokenLimit: 131072,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek Flash',
    url: 'https://api.deepseek.com/chat/completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-flash',
    budgetParam: 'max_tokens',
    maxCompletionTokens: 65536,
    hardTokenLimit: 393216,
  },
};

export function normalizeProviderId(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDER_DEFINITIONS, value)
    ? value
    : DEFAULT_PROVIDER_ID;
}

function completionEndpoint(value, fallback) {
  const url = new URL(typeof value === 'string' && value.trim() ? value.trim() : fallback);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('Invalid provider endpoint');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  return url.toString();
}

export function resolveProvider(providerId, env = {}) {
  const definition = PROVIDER_DEFINITIONS[normalizeProviderId(providerId)];
  const prefix = definition.apiKeyEnv.replace(/_API_KEY$/, '');
  const ceiling = Number.parseInt(env[`${prefix}_MAX_COMPLETION_TOKENS`] || '', 10);
  const budgetParam = env[`${prefix}_BUDGET_PARAM`] || definition.budgetParam;
  if (!['max_tokens', 'max_completion_tokens'].includes(budgetParam)) {
    throw new Error('Invalid provider token parameter');
  }
  return {
    ...definition,
    apiKey: env[definition.apiKeyEnv]?.trim(),
    url: completionEndpoint(env[`${prefix}_BASE_URL`], definition.url),
    // Keep MiMo pinned so obsolete deployment variables cannot restore retired models.
    model: definition.id === 'mimo'
      ? definition.defaultModel
      : env[`${prefix}_MODEL`]?.trim() || definition.defaultModel,
    budgetParam,
    maxCompletionTokens: Number.isFinite(ceiling) && ceiling > 0
      ? Math.min(ceiling, definition.hardTokenLimit)
      : definition.maxCompletionTokens,
  };
}

export function listProviders() {
  return Object.values(PROVIDER_DEFINITIONS).map(({ id, label, defaultModel }) => ({ id, label, model: defaultModel }));
}

export function buildProviderRequest(provider, { messages, budget, temperature = 0.3 }) {
  return {
    url: provider.url,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: {
      model: provider.model,
      messages,
      [provider.budgetParam]: Math.min(budget, provider.maxCompletionTokens),
      temperature,
      stream: true,
      thinking: { type: 'disabled' },
    },
  };
}
