/**
 * GET /api/products
 *
 * Fetches the product catalog from Checkfront v3 API.
 * Returns item IDs, names, and SKUs for building the stall map.
 *
 * Query params:
 *   categories — comma-separated category IDs (default: from env)
 *
 * Checkfront v3 endpoint: GET /api/3.0/item?category_id=X
 * If Public API is enabled, no auth needed.
 * If not, uses Basic Auth with CF_API_KEY / CF_API_SECRET.
 */

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const categories = req.query.categories || process.env.CF_BARN_B_CATEGORIES;
  if (!categories) {
    return res.status(400).json({ error: 'categories parameter required' });
  }

  const subdomain = process.env.CF_SUBDOMAIN;
  const domain = process.env.CF_DOMAIN || 'checkfront.com';
  const baseUrl = `https://${subdomain}.${domain}/api/3.0`;

  // Build headers — include auth if credentials are configured
  const headers = { 'Accept': 'application/json' };
  if (process.env.CF_API_KEY && process.env.CF_API_SECRET) {
    const creds = Buffer.from(
      `${process.env.CF_API_KEY}:${process.env.CF_API_SECRET}`
    ).toString('base64');
    headers['Authorization'] = `Basic ${creds}`;
  }

  try {
    const url = `${baseUrl}/item?category_id=${encodeURIComponent(categories)}`;
    const resp = await fetch(url, { headers });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`Checkfront API error ${resp.status}:`, text.substring(0, 300));
      return res.status(502).json({ error: `Checkfront API returned ${resp.status}` });
    }

    const data = await resp.json();

    // v3 returns items as an object keyed by item_id, or sometimes as an array
    // Normalize into a flat array matching what the frontend expects
    const rawItems = data.items || data.item || {};
    const itemList = Array.isArray(rawItems) ? rawItems : Object.values(rawItems);

    const products = itemList
      .filter(item => item && item.item_id)
      .map(item => ({
        id: item.item_id,
        name: item.name || '',
        sku: item.sku || '',
      }));

    // Cache product list for 5 minutes — it rarely changes
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.json({ products });

  } catch (err) {
    console.error('Products fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
