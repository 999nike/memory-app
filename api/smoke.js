import { generateText } from 'ai';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await generateText({
      model: 'google/gemini-3.1-flash-lite',
      prompt: 'Reply with exactly: MEMORY_AI_OK'
    });
    return res.status(200).json({ ok: result.text.trim() });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'AI smoke test failed' });
  }
}
