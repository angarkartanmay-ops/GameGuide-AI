export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { game, q } = req.query;

  if (!game || !q) {
    return res.status(400).json({ error: 'Missing game or q parameter' });
  }

  try {
    const fandomUrl = `https://${game}.fandom.com/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=5&format=json`;
    const response = await fetch(fandomUrl, {
      headers: { 'User-Agent': 'GameGuide-AI/1.0 (educational project)' }
    });
    
    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
