/**
 * POST /api/log
 *
 * Lightweight diagnostic logging for Circle T booking app.
 * Does not store customer info or payment info.
 */

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const event = req.body || {};

    const safeEvent = {
      receivedAt: new Date().toISOString(),
      sessionId: event.sessionId || null,
      event: event.event || 'unknown',
      url: event.url || null,
      referrer: event.referrer || null,

      startDate: event.startDate || null,
      endDate: event.endDate || null,
      area: event.area || null,
      label: event.label || null,
      itemId: event.itemId || null,

      widgetState: event.widgetState || null,
      cartItemsCount: event.cartItemsCount ?? null,
      cartProductIds: Array.isArray(event.cartProductIds) ? event.cartProductIds : [],
      hasSavedCheckfrontCart: !!event.hasSavedCheckfrontCart,

      visibilityState: event.visibilityState || null,
      viewport: event.viewport || null,
      userAgent: event.userAgent || null,

      message: event.message || null,
      extra: event.extra || null,
    };

    console.log('[CTA_BOOKING_APP]', JSON.stringify(safeEvent));

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[CTA_BOOKING_APP_LOG_ERROR]', err);
    return res.status(500).json({ error: 'Failed to log event' });
  }
};
