/**
 * GET /api/bookings
 *
 * Fetches all active bookings for a date range via Checkfront v4 API.
 * Returns a set of booked item IDs so the frontend can color the map.
 *
 * This is the "flip the question" approach: instead of asking
 * "is each of 240 stalls available?" (slow — 370ms per item),
 * we ask "what's booked?" and mark everything else as available.
 *
 * Params:
 *   start  — YYYYMMDD (check-in date)
 *   end    — YYYYMMDD (check-out date)
 *
 * Returns:
 *   {
 *     booked: {
 *       "106743": { code: "PRLM-071125", customer: "First L.", status: "PAID" },
 *       ...
 *     },
 *     fetchedAt: "2026-03-04T19:30:00Z"
 *   }
 *
 * Requires CF_API_KEY and CF_API_SECRET environment variables (v4 is auth-only).
 */

const V4_BASE = 'https://circle-t-arena.manage.na1.bookingplatform.app/api/4.0';
const PAGE_SIZE = 100;

// Statuses that mean "this stall is taken" — everything except VOID
const ACTIVE_STATUSES = new Set(['PAID', 'STOP', 'PRODU', 'PRE']);

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

  // Convert YYYYMMDD to ISO date strings for v4 API
  const isoStart = `${start.substring(0,4)}-${start.substring(4,6)}-${start.substring(6,8)}T00:00:00`;
  const isoEnd = `${end.substring(0,4)}-${end.substring(4,6)}-${end.substring(6,8)}T23:59:59`;

  try {
    // ── Fetch all bookings overlapping the date range ──
    const allBookings = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const url = `${V4_BASE}/bookings?limit=${PAGE_SIZE}&offset=${offset}&inProgressMin=${encodeURIComponent(isoStart)}&inProgressMax=${encodeURIComponent(isoEnd)}`;

      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        console.error(`v4 API error: ${resp.status}`);
        return res.status(502).json({ error: `Checkfront API returned ${resp.status}` });
      }

      const data = await resp.json();

      if (data.data && data.data.length > 0) {
        allBookings.push(...data.data);
      }

      total = (data.meta && data.meta.records) ? data.meta.records.total : 0;
      offset += PAGE_SIZE;
    }

    // ── Parse bookings into booked item IDs ──
    // Use the same exclusive end-date logic as OccupancyBackend.gs
    const rangeStartIso = `${start.substring(0,4)}-${start.substring(4,6)}-${start.substring(6,8)}`;
    const rangeEndIso = `${end.substring(0,4)}-${end.substring(4,6)}-${end.substring(6,8)}`;

    const booked = {};
    const seen = new Set();

    for (const booking of allBookings) {
      // Skip duplicates and voided bookings
      if (seen.has(booking.code)) continue;
      if (!ACTIVE_STATUSES.has(booking.statusId)) continue;
      seen.add(booking.code);

      // Exclusive end-date logic (matches occupancy backend)
      const bStart = String(booking.start).substring(0, 10);
      const bEnd = String(booking.end).substring(0, 10);
      const isSameDay = (bStart === bEnd);

      let isActive;
      if (isSameDay) {
        isActive = (bStart >= rangeStartIso && bStart <= rangeEndIso);
      } else {
        isActive = (bStart <= rangeEndIso && bEnd > rangeStartIso);
      }
      if (!isActive) continue;

      // Parse itemSummary to find stall/RV names, then match to item IDs
      // v4 doesn't return item IDs directly, so we extract stall/RV numbers
      // from itemSummary and the frontend maps them to cells
      const summary = booking.itemSummary || '';
      const items = summary.split(', ').map(s => s.trim()).filter(s => s);

      const stallNumbers = [];
      const rvNumbers = [];

      for (const item of items) {
        if (/^additional shavings$/i.test(item)) continue;
        if (/^shavings$/i.test(item)) continue;

        const numMatch = item.match(/(?:stall|rv)\s+(\d+)/i);
        if (numMatch) {
          const num = parseInt(numMatch[1]);
          if (/\brv\b/i.test(item)) {
            rvNumbers.push(num);
          } else if (/stall/i.test(item)) {
            stallNumbers.push(num);
          }
        }
      }

      // Store booking info keyed by stall/RV number
      // (frontend will map these to cells)
      const firstName = booking.firstName || '';
      const lastInitial = booking.lastName ? booking.lastName.charAt(0) + '.' : '';
      const info = {
        code: booking.code,
        customer: (firstName + ' ' + lastInitial).trim(),
        status: booking.statusId,
        start: bStart,
        end: bEnd,
      };

      for (const n of stallNumbers) {
        booked['stall_' + n] = info;
      }
      for (const n of rvNumbers) {
        booked['rv_' + n] = info;
      }
    }

    // Cache for 2 minutes — availability doesn't change every second
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');

    return res.json({
      booked,
      totalBookings: allBookings.length,
      activeBookings: seen.size,
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('Bookings fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
