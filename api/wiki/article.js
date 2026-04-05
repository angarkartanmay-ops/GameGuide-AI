export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { game, title } = req.query;

  if (!game || !title) {
    return res.status(400).json({ error: 'Missing game or title parameter' });
  }

  try {
    const fandomUrl = `https://${game}.fandom.com/api.php?action=query&titles=${encodeURIComponent(title)}&prop=extracts&exintro=false&explaintext=true&exsectionformat=plain&format=json`;
    const response = await fetch(fandomUrl, {
      headers: { 'User-Agent': 'GameGuide-AI/1.0 (educational project)' }
    });
    
    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
