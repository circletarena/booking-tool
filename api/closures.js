/**
 * GET /api/closures
 *
 * Fetches product closures from Checkfront v4 API.
 * Returns a set of product IDs that are closed for the given date range.
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

const V4_BASE = 'https://circle-t-arena.manage.na1.bookingplatform.app/api/4.0';

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
