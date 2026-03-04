/**
 * GET /api/availability
 *
 * Fetches rated availability from Checkfront v3 API.
 *
 * Modes:
 *   Single:  ?item_id=123&start=YYYYMMDD&end=YYYYMMDD
 *   Chunk:   ?item_ids=123,456,789&start=YYYYMMDD&end=YYYYMMDD
 *
 * The frontend fires multiple chunk requests in parallel (8 requests of ~30
 * items each) so each finishes well under Vercel's 10s function timeout.
 * This replaces the old single-category bulk call that took 1.5 minutes.
 */

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { item_id, item_ids, start, end } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: 'start and end date parameters required (YYYYMMDD)' });
  }
  if (!item_id && !item_ids) {
    return res.status(400).json({ error: 'item_id or item_ids parameter required' });
  }

  const subdomain = process.env.CF_SUBDOMAIN;
  const domain = process.env.CF_DOMAIN || 'manage.na1.bookingplatform.app';
  const baseUrl = `https://${subdomain}.${domain}/api/3.0`;

  // Build headers — include auth only if credentials exist
  const headers = { 'Accept': 'application/json' };
  if (process.env.CF_API_KEY && process.env.CF_API_SECRET) {
    const creds = Buffer.from(
      `${process.env.CF_API_KEY}:${process.env.CF_API_SECRET}`
    ).toString('base64');
    headers['Authorization'] = `Basic ${creds}`;
  }

  try {
    if (item_id) {
      // ── Single item ──
      const result = await fetchSingleItem(baseUrl, headers, item_id, start, end);
      return res.json(result);
    } else {
      // ── Chunk of items ──
      const ids = item_ids.split(',').map(id => id.trim()).filter(Boolean);
      const results = await Promise.all(
        ids.map(id => fetchSingleItem(baseUrl, headers, id, start, end))
      );
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.json({ results });
    }
  } catch (err) {
    console.error('Availability fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};


/**
 * Fetch rated availability for a single item.
 * v3 endpoint: GET /api/3.0/item/{item_id}?start_date=X&end_date=Y
 */
async function fetchSingleItem(baseUrl, headers, itemId, start, end) {
  const url = `${baseUrl}/item/${itemId}?start_date=${start}&end_date=${end}`;

  try {
    const resp = await fetch(url, { headers });

    if (!resp.ok) {
      return { itemId: parseInt(itemId), available: false, error: `API ${resp.status}` };
    }

    const data = await resp.json();
    return normalizeItem(data.item || {});
  } catch (err) {
    return { itemId: parseInt(itemId), available: false, error: err.message };
  }
}


/**
 * Normalize a v3 rated item into the format the frontend expects.
 *
 * Confirmed v3 response structure (from live API):
 *
 *   item.item_id            — number (e.g. 106743)
 *   item.name               — string (e.g. "Barn B - Regular - Stall 200")
 *   item.rate.status        — "CLOSED" = sold out, anything else = available
 *   item.rate.available     — number (1 = stock exists, but NOT the same as bookable)
 *   item.rate.slip          — booking SLIP string (exists even when CLOSED)
 *   item.rate.summary.title — "Sold out" when closed, rate label when available
 *   item.rate.summary.price.title — HTML like "<span>$30.00</span>" (per-night)
 *   item.rate.summary.price.total — string like "$60.00" (stay total)
 *   item.rate.summary.price.unit  — "per night"
 *   item.rate.summary.details     — HTML with breakdown
 *   item.rate.summary.date        — date range string
 */
function normalizeItem(item) {
  const rate = item.rate || {};
  const slip = rate.slip || null;

  // CRITICAL: rate.status === "CLOSED" means sold out, even if rate.available === 1
  // and even if a slip exists. Must check status, not just slip presence.
  const isAvailable = !!(slip && rate.status !== 'CLOSED');

  // Extract price from rate.summary.price
  const price = (rate.summary && rate.summary.price) || {};

  // price.title is HTML like "<span>$30.00</span>" — strip tags for display
  const priceTitle = stripHtml(price.title || '');
  // price.total is already a string like "$60.00"
  const priceTotal = price.total || '';

  return {
    itemId: parseInt(item.item_id) || 0,
    name: item.name || '',
    available: isAvailable,
    slip: slip,
    priceTitle: priceTitle,
    priceTotal: priceTotal,
  };
}


/**
 * Strip HTML tags from a string.
 */
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}
