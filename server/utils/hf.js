const HF_MODEL = 'meta-llama/Llama-3.1-70B-Instruct';
const HF_API_URL = 'https://router.huggingface.co/v1/chat/completions';

async function callModel(systemPrompt, userPrompt) {
  const apiKey = process.env.HF_API_KEY;
  if (!apiKey) {
    throw new Error('HF_API_KEY is not configured');
  }

  const payload = {
    model: HF_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 4096,
    temperature: 0,
    response_format: { type: 'json_object' }
  };

  const response = await fetch(HF_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Hugging Face API error (${response.status}): ${text}`);
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
    throw new Error(`Received empty response from Hugging Face Inference API. Raw: ${JSON.stringify(result)}`);
  }

  return content;
}

module.exports = {
  callModel
};
