// Minimal Anthropic Messages helper with streaming.
//
// Large extractions (a full tree register can be tens of thousands of tokens)
// take minutes to generate. A normal non-streaming fetch holds one open request
// the whole time and trips the socket/body timeout → "fetch failed". Streaming
// keeps bytes flowing (and the API sends periodic pings), so the connection
// stays alive; we accumulate the text deltas and return the full string.

const API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Run a single-message request and return the concatenated text output.
 * Streams server-sent events so very long outputs don't time out.
 */
export async function streamMessageText({
  content,
  model = 'claude-sonnet-4-6',
  maxTokens = 64000,
  apiKey = process.env.ANTHROPIC_API_KEY,
  betas = ['files-api-2025-04-14'],
} = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': betas.join(','),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, stream: true, messages: [{ role: 'user', content }] }),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(errText || `Anthropic request failed (${res.status})`);
  }

  let text = '';
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') text += evt.delta.text;
      else if (evt.type === 'error') throw new Error(evt.error?.message || 'Anthropic stream error');
    }
  }
  return text;
}
