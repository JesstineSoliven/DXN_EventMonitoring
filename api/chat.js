module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { messages, model, max_tokens, temperature } = req.body || {};
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'Missing "messages"' });
    return;
  }

  try {
    const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model:       model || 'gpt-4o-mini',
        stream:      true,
        max_tokens:  max_tokens || 600,
        temperature: temperature ?? 0.7,
        messages,
      }),
    });

    if (!apiRes.ok || !apiRes.body) {
      const errBody = await apiRes.text();
      res.status(apiRes.status).send(errBody);
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const reader = apiRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
