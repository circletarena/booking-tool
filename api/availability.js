/**
 * GET /api/availability
 *
 * Fetches rated availability for a SINGLE item from Checkfront v3 API.
 * Used when a customer clicks a stall — returns pricing and booking SLIP.
 *
 * The map coloring is handled by /api/bookings (v4, fast).
 * This endpoint is only called on click for the detail panel.
 *
 * Params:
 *   item_id — Checkfront item ID
 *   start   — YYYYMMDD
 *   end     — YYYYMMDD
 *
 * Returns:
 *   { itemId, name, available, slip, priceTitle, priceTotal, priceUnit, nights, dateRange }
 */

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { item_id, start, end } = req.query;
  if (!item_id || !start || !end) {
    return res.status(400).json({ error: 'item_id, start, and end parameters required' });
  }

  const subdomain = process.env.CF_SUBDOMAIN;
  const domain = process.env.CF_DOMAIN || 'manage.na1.bookingplatform.app';
  const baseUrl = `https://${subdomain}.${domain}/api/3.0`;

  // v3 Public API — no auth needed if Public API is enabled
  // Falls back to authenticated if credentials are present
  const headers = { 'Accept': 'application/json' };
  if (process.env.CF_API_KEY && process.env.CF_API_SECRET) {
    const creds = Buffer.from(
      `${process.env.CF_API_KEY}:${process.env.CF_API_SECRET}`
    ).toString('base64');
    headers['Authorization'] = `Basic ${creds}`;
  }

  try {
    const url = `${baseUrl}/item/${item_id}?start_date=${start}&end_date=${end}`;
    const resp = await fetch(url, { headers });

    if (!resp.ok) {
      return res.json({ itemId: parseInt(item_id), available: false, error: `API ${resp.status}` });
    }

    const data = await resp.json();
    const item = data.item || {};
    const result = normalizeItem(item);

    return res.json(result);

  } catch (err) {
    console.error('Availability error:', err.message);
    return res.json({ itemId: parseInt(item_id), available: false, error: err.message });
  }
};


/**
 * Normalize a v3 rated item response.
 *
 * Confirmed v3 structure (from live API testing):
 *   item.rate.status        — "CLOSED" = sold out
 *   item.rate.slip          — booking SLIP (exists even when CLOSED)
 *   item.rate.summary.title — "Sold out" or rate label
 *   item.rate.summary.price.title — HTML "<span>$30.00</span>" (per-night)
 *   item.rate.summary.price.total — "$60.00" (stay total)
 *   item.rate.summary.price.unit  — "per night"
 *   item.rate.summary.date        — date range string
 */
function normalizeItem(item) {
  const rate = item.rate || {};
  const slip = rate.slip || null;

  // rate.status === "CLOSED" means sold out, even if rate.available === 1
  const isAvailable = !!(slip && rate.status !== 'CLOSED');

  const summary = rate.summary || {};
  const price = summary.price || {};

  return {
    itemId: parseInt(item.item_id) || 0,
    name: item.name || '',
    available: isAvailable,
    slip: slip,
    priceTitle: stripHtml(price.title || ''),
    priceTotal: price.total || '',
    priceUnit: price.unit || '',
    nights: item.days || 0,
    dateRange: summary.date || '',
  };
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}
