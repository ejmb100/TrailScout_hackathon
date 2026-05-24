const { generateJson, intentPrompt } = require('./gemini-common.cjs');

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const body = await readJson(req);
    const userRequest = String(body.userRequest || '').trim();
    if (!userRequest) {
      res.status(400).setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify({ error: 'Missing userRequest' }));
      return;
    }

    const result = await generateJson(intentPrompt(userRequest));
    if (result.status !== 200) {
      res.status(result.status).setHeader('Content-Type', 'application/json');
      res.send(result.text);
      return;
    }

    res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify({ profile: result.value }));
  } catch (error) {
    console.error('[gemini-intent] handler failed:', error);
    res.status(502).setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ error: 'Gemini intent proxy failed', fallbackReason: 'server_handler_error' }));
  }
};
