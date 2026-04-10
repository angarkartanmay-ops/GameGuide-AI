export default async function handler(req, res) {
  // Add CORS Headers if needed
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { game, title } = req.query;

    if (!game || !title) {
      return res.status(400).json({ error: 'Missing game or title parameter' });
    }

    const fandomUrl = `https://${game}.fandom.com/api.php?action=query&titles=${encodeURIComponent(title)}&prop=extracts&exintro=false&explaintext=true&exsectionformat=plain&format=json`;
    
    const response = await fetch(fandomUrl, {
      headers: { 'User-Agent': 'GameGuide-AI/1.0 (educational project)' }
    });
    
    const data = await response.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
