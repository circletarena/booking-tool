/**
 * GET /api/closures
 *
 * Fetches product closures from Checkfront v4 API.
 * Returns a set of product IDs that are closed for the given date range.
 *
 * Also applies site-only EVENT_BLACKOUTS (defined below). These block dates
 * on this website only. They are NOT created in Checkfront, so staff can
 * still book those dates through the Checkfront staff booking page.
 *
 * Params:
 *   start  — YYYYMMDD (check-in date)
 *   end    — YYYYMMDD (check-out date)
 *
 * Returns:
 *   {
 *     closedProductIds: [106752, 106756, ...],
 *     closures: [{ name, startDate, endDate, productCount }],
 *     fetchedAt: "2026-03-06T..."
 *   }
 */

const V4_BASE = 'https://circle-t-arena.checkfront.com/api/4.0';

/**
 * Site-only blackouts for staff-only events.
 *
 *   firstNight / lastNight — YYYY-MM-DD, the first and last nights guests
 *                            would stay. Checking out on firstNight is allowed.
 *   appliesTo              — 'all' for every product, or an array of
 *                            product IDs, e.g. [106752, 106756]
 *
 * To remove a blackout after the event, delete its entry from this list.
 */
const EVENT_BLACKOUTS = [
  {
    name: 'Private event (staff booking only)',
    firstNight: '2027-03-22', // TODO: confirm with Circle T
    lastNight: '2027-03-28',  // TODO: confirm 28th is a night, not departure day
    appliesTo: 'all',
  },
];

// True if the selected dates touch any night in the blackout.
// Same-day selections (start === end) are treated as that single date.
function blackoutOverlaps(blackout, rangeStart, rangeEnd) {
  if (rangeEnd <= rangeStart) {
    return rangeStart >= blackout.firstNight && rangeStart <= blackout.lastNight;
  }
  return rangeStart <= blackout.lastNight && rangeEnd > blackout.firstNight;
}

// Fetches every product ID, using the same v3 item endpoint as products.js
async function fetchAllProductIds(headers) {
  const subdomain = process.env.CF_SUBDOMAIN;
  const domain = process.env.CF_DOMAIN || 'checkfront.com';
  const resp = await fetch(`https://${subdomain}.${domain}/api/3.0/item`, { headers });
  if (!resp.ok) {
    throw new Error(`Checkfront item API returned ${resp.status}`);
  }
  const data = await resp.json();
  const rawItems = data.items || data.item || {};
  const itemList = Array.isArray(rawItems) ? rawItems : Object.values(rawItems);
  return itemList
    .filter(item => item && item.item_id)
    .map(item => Number(item.item_id));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { start, end } = req.query;
  if (!start || !end) {
    return res.status(400).json({ error: 'start and end parameters required (YYYYMMDD)' });
  }

  const apiKey = process.env.CF_API_KEY;
  const apiSecret = process.env.CF_API_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: 'API credentials not configured' });
  }

  const creds = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const headers = {
    'Authorization': `Basic ${creds}`,
    'Accept': 'application/json',
  };

  // Convert YYYYMMDD to ISO date strings for comparison
  const rangeStart = `${start.substring(0,4)}-${start.substring(4,6)}-${start.substring(6,8)}`;
  const rangeEnd = `${end.substring(0,4)}-${end.substring(4,6)}-${end.substring(6,8)}`;

  try {
    const resp = await fetch(`${V4_BASE}/closures`, { headers });
    if (!resp.ok) {
      console.error(`v4 closures API error: ${resp.status}`);
      return res.status(502).json({ error: `Checkfront API returned ${resp.status}` });
    }

    const data = await resp.json();
    const allClosures = data.data || [];

    // Filter to enabled closures that overlap our date range
    const closedProductIds = new Set();
    const matchedClosures = [];

    for (const closure of allClosures) {
      if (!closure.enabled) continue;

      // Check date overlap: closure overlaps range if
      // closure.startDate <= rangeEnd AND closure.endDate >= rangeStart
      if (closure.startDate <= rangeEnd && closure.endDate >= rangeStart) {
        const ids = closure.productIds || [];
        for (const id of ids) {
          closedProductIds.add(id);
        }
        matchedClosures.push({
          name: closure.name,
          startDate: closure.startDate,
          endDate: closure.endDate,
          productCount: ids.length,
        });
      }
    }

    // Apply site-only event blackouts.
    // Products are only fetched when a blackout actually overlaps,
    // so all other dates behave exactly as before.
    const activeBlackouts = EVENT_BLACKOUTS.filter(b => blackoutOverlaps(b, rangeStart, rangeEnd));
    if (activeBlackouts.length > 0) {
      let allProductIds = null;
      for (const blackout of activeBlackouts) {
        let ids;
        if (blackout.appliesTo === 'all') {
          if (!allProductIds) allProductIds = await fetchAllProductIds(headers);
          ids = allProductIds;
        } else {
          ids = blackout.appliesTo.map(Number);
        }
        for (const id of ids) {
          closedProductIds.add(id);
        }
        matchedClosures.push({
          name: blackout.name,
          startDate: blackout.firstNight,
          endDate: blackout.lastNight,
          productCount: ids.length,
        });
      }
    }

    // Cache for 5 minutes — closures don't change often
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    return res.json({
      closedProductIds: Array.from(closedProductIds),
      closures: matchedClosures,
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('Closures fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
