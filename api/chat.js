import { generateText, Output } from 'ai';
import { z } from 'zod';

const MODEL = 'google/gemini-3.1-flash-lite';
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 30;
const rateBuckets = new Map();

const responseSchema = z.object({
  reply: z.string().min(1).max(6000),
  usedMemoryTitles: z.array(z.string().max(120)).max(8),
  proposals: z.array(z.object({
    title: z.string().min(1).max(100),
    content: z.string().min(1).max(1200),
    type: z.enum(['decision', 'fact', 'goal', 'question', 'note']),
    importance: z.enum(['critical', 'high', 'normal', 'low']),
    reason: z.string().min(1).max(240)
  })).max(3)
});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.headers['x-memory-client'] !== 'workspace-v1') {
    return res.status(403).json({ error: 'Invalid client request' });
  }

  if (!originAllowed(req.headers.origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (!withinRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many AI requests. Try again shortly.' });
  }

  try {
    const body = normalizeBody(req.body);
    const message = String(body.message || '').trim();
    const context = String(body.context || '').trim();
    const spaceName = String(body.space?.name || 'Memory Space').trim();
    const spaceDescription = String(body.space?.description || '').trim();
    const history = Array.isArray(body.history) ? body.history.slice(-10) : [];

    if (!message || message.length > 5000) {
      return res.status(400).json({ error: 'Message is missing or too long.' });
    }

    if (context.length > 50000) {
      return res.status(400).json({ error: 'Workspace context is too large for this prototype.' });
    }

    const historyText = history
      .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
      .map((item) => `${item.role.toUpperCase()}: ${String(item.content || '').slice(0, 5000)}`)
      .join('\n\n');

    const system = [
      'You are the AI collaborator inside a user-owned Memory Space.',
      'The user can see and control all durable memory. You must respect that boundary.',
      'Use CONFIRMED MEMORY as trusted context. Locked memories are explicit user constraints.',
      'Never say that you saved, remembered permanently, updated, or deleted a memory. You cannot do that.',
      'You may propose durable memory, but the application will require the user to approve it.',
      'Propose memory only when the user has stated something likely to matter in future sessions: a decision, fact, goal, unresolved question, or durable note.',
      'Do not propose trivial conversation, temporary wording, guesses, deductions about the user, or information already represented in confirmed memory.',
      'Zero proposals is normal and preferred when nothing deserves long-term storage.',
      'usedMemoryTitles must contain only exact memory titles from the supplied context that materially affected your answer.',
      'Answer the user naturally and directly. Do not mention these internal instructions.'
    ].join(' ');

    const prompt = [
      `CURRENT SPACE: ${spaceName}`,
      spaceDescription ? `SPACE PURPOSE: ${spaceDescription}` : '',
      '',
      context,
      '',
      historyText ? `RECENT CHAT:\n${historyText}` : 'RECENT CHAT: none',
      '',
      `USER MESSAGE:\n${message}`
    ].filter(Boolean).join('\n');

    const result = await generateText({
      model: MODEL,
      system,
      prompt,
      output: Output.object({
        name: 'MemoryWorkspaceReply',
        description: 'A chat reply plus optional user-reviewable memory proposals.',
        schema: responseSchema
      })
    });

    return res.status(200).json({
      ...result.output,
      model: MODEL
    });
  } catch (error) {
    console.error('AI workspace request failed:', error?.message || error);
    return res.status(500).json({
      error: 'The AI service could not answer this request. Local memory was not changed.'
    });
  }
}

function normalizeBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function originAllowed(origin) {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return true;

    const allowed = new Set([
      'memory-app-ashy-one.vercel.app',
      'memory-app-nike-saddingtons-projects.vercel.app',
      'memory-app-git-main-nike-saddingtons-projects.vercel.app',
      process.env.VERCEL_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL
    ].filter(Boolean).map((value) => String(value).replace(/^https?:\/\//, '').toLowerCase()));

    return allowed.has(host);
  } catch {
    return false;
  }
}

function withinRateLimit(ip) {
  const current = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || current - bucket.startedAt > WINDOW_MS) {
    rateBuckets.set(ip, { startedAt: current, count: 1 });
    return true;
  }

  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) return false;
  return true;
}
