/**
 * LLM Abstraction Layer
 *
 * Supports multiple LLM providers:
 * - Ollama (local deployment)
 * - HuggingFace Inference API
 *
 * Provider is selected via LLM_PROVIDER environment variable.
 */

// HuggingFace Configuration
const HF_MODEL = 'Qwen/Qwen2.5-72B-Instruct';
const HF_API_URL = 'https://router.huggingface.co/v1/chat/completions';

// Helper function to get environment variables (reads at runtime, not module load time)
function getEnvConfig() {
  return {
    provider: process.env.LLM_PROVIDER || 'huggingface',
    hfApiKey: process.env.HF_API_KEY,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'llama3.1:8b'
  };
}

/**
 * Call Ollama API
 * @param {string} systemPrompt - System instructions
 * @param {string} userPrompt - User query
 * @param {number} temperature - Temperature for sampling (0-1)
 * @returns {Promise<string>} - Generated response
 */
async function callOllama(systemPrompt, userPrompt, temperature = 0) {
  const config = getEnvConfig();

  console.log(`[LLM] Calling Ollama at ${config.ollamaBaseUrl} with model ${config.ollamaModel}`);

  const startTime = Date.now();

  const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.ollamaModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      stream: false,
      format: 'json',
      options: {
        temperature,
        num_predict: 4096
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama API error (${response.status}): ${text}`);
  }

  const result = await response.json();

  const elapsed = Date.now() - startTime;
  console.log(`[LLM] Ollama response received in ${(elapsed / 1000).toFixed(1)}s`);

  // Ollama returns { message: { role: 'assistant', content: '...' } }
  const content = result?.message?.content;

  if (!content) {
    throw new Error(`Received empty response from Ollama API. Raw: ${JSON.stringify(result)}`);
  }

  return content;
}

/**
 * Call HuggingFace Inference API
 * @param {string} systemPrompt - System instructions
 * @param {string} userPrompt - User query
 * @param {number} temperature - Temperature for sampling (0-1)
 * @returns {Promise<string>} - Generated response
 */
async function callHuggingFace(systemPrompt, userPrompt, temperature = 0) {
  const config = getEnvConfig();

  if (!config.hfApiKey) {
    throw new Error('HF_API_KEY is not configured');
  }

  const payload = {
    model: HF_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 4096,
    temperature,
    response_format: { type: 'json_object' }
  };

  const response = await fetch(HF_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.hfApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HuggingFace API error (${response.status}): ${text}`);
  }

  const result = await response.json();

  const choice = result?.choices?.[0];
  const message = choice?.message;
  const content = Array.isArray(message?.content)
    ? message.content
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }
          if (item && typeof item.text === 'string') {
            return item.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('')
    : typeof message?.content === 'string'
      ? message.content
      : '';

  if (!content) {
    throw new Error(`Received empty response from HuggingFace API. Raw: ${JSON.stringify(result)}`);
  }

  return content;
}

/**
 * Call the configured LLM provider
 * @param {string} systemPrompt - System instructions
 * @param {string} userPrompt - User query
 * @param {number} temperature - Temperature for sampling (0-1)
 * @returns {Promise<string>} - Generated response
 */
async function callModel(systemPrompt, userPrompt, temperature = 0) {
  const config = getEnvConfig();
  const provider = config.provider.toLowerCase();

  console.log(`[LLM] Using provider: ${provider}`);

  switch (provider) {
    case 'ollama':
      return callOllama(systemPrompt, userPrompt, temperature);

    case 'huggingface':
      return callHuggingFace(systemPrompt, userPrompt, temperature);

    default:
      throw new Error(
        `Unknown LLM provider: ${config.provider}. Valid options: 'ollama', 'huggingface'`
      );
  }
}

module.exports = {
  callModel,
  callOllama,
  callHuggingFace
};
