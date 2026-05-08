/**
 * POST /api/log
 *
 * Circle T Arena lightweight journey logger.
 * Logs sanitized booking-app journey events to Vercel and Google Sheets.
 *
 * Safe by design:
 * - no customer names
 * - no emails
 * - no phone numbers
 * - no payment details
 * - no raw Checkfront form payloads
 */

const JOURNEY_SHEETS_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbzv_AziDj0olyUIwotSpfL-QmwLE0i_rLij9ZL7UcigCtT54ZXgXy4dUjIXEhrJbiaCyw/exec';

const JOURNEY_SHEETS_SECRET = 'circleT-log-webhook-2026-05-08-weekend';

const ALLOWED_EVENTS = new Set([
  'APP_LOADED',
  'DATES_CHANGED',
  'AREA_OPENED',
  'PRODUCT_SELECTED',
  'AVAILABILITY_CONFIRMED',
  'AVAILABILITY_BLOCKED',
  'BOOK_SELECTED',
  'WIDGET_OPENED',
  'PRODUCT_WIDGET_RENDERED',
  'CART_CONFIRMED',
  'CART_EMPTY_RECEIVED',
  'CART_EMPTY_SUPPRESSED',
  'CART_EMPTY_ACCEPTED_CLEARING_SESSION',
  'CHECKFRONT_ADD_MORE_TRANSITION_DETECTED',
  'RETURNED_TO_MAP',
  'WIDGET_COLLAPSED_TO_DOCK',
  'DOCK_REOPENED',
  'PAGE_HIDDEN_WITH_ACTIVE_CART',
  'PAGEHIDE_WITH_ACTIVE_CART',
  'BEFOREUNLOAD_WITH_ACTIVE_CART',
  'JS_ERROR',
  'UNHANDLED_REJECTION'
]);

const SENSITIVE_KEY_RE =
  /(email|e-mail|phone|mobile|tel|customer|first\s*name|last\s*name|fullname|full_name|address|street|zip|postal|city|state|country|card|cc|cvv|cvc|payment|token|authorization|auth|password|passphrase|secret|cookie|form|billing|shipping)/i;

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function truncateString(value, max = 300) {
  if (typeof value !== 'string') return value;
  return value.length > max ? value.slice(0, max) + '…' : value;
}

function sanitizeCartItem(item) {
  if (!isPlainObject(item)) return null;

  return {
    item_id: truncateString(
      String(item.item_id || item.itemId || item.product_id || item.productId || ''),
      80
    ),
    product_id: truncateString(
      String(item.product_id || item.productId || item.item_id || item.itemId || ''),
      80
    ),
    sku: truncateString(String(item.sku || ''), 120),
    slip: truncateString(String(item.slip || ''), 160),
    qty:
      typeof item.qty !== 'undefined'
        ? item.qty
        : typeof item.quantity !== 'undefined'
          ? item.quantity
          : null,
    productName: truncateString(
      String(item.productName || item.item_name || item.title || ''),
      180
    )
  };
}

function sanitizeValue(value, depth = 0, parentKey = '') {
  if (depth > 5) return '[max_depth]';
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const key = String(parentKey || '').toLowerCase();

    if (key.includes('cart') || key.includes('primarycartitems')) {
      return value.slice(0, 20).map(sanitizeCartItem).filter(Boolean);
    }

    return value.slice(0, 20).map((entry) => sanitizeValue(entry, depth + 1, parentKey));
  }

  if (isPlainObject(value)) {
    const out = {};

    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = '[redacted]';
        continue;
      }

      // Product names should arrive as productName. A raw "name" key is too often a customer field.
      if (key === 'name') {
        out[key] = '[redacted_name_key]';
        continue;
      }

      out[key] = sanitizeValue(entry, depth + 1, key);
    }

    return out;
  }

  return String(value).slice(0, 120);
}

function pickString(body, key, max = 240) {
  const value = body && typeof body[key] !== 'undefined' ? body[key] : null;
  return typeof value === 'string' ? truncateString(value, max) : value;
}

function normalizeEventName(body) {
  return String(body.event || '').trim().toUpperCase();
}

function sanitizeEvent(body = {}, req) {
  const event = normalizeEventName(body);

  // Ignore unknown/noisy legacy events instead of flooding logs.
  if (!ALLOWED_EVENTS.has(event)) return null;

  return {
    prefix: 'CTA_JOURNEY',
    event,
    receivedAt: new Date().toISOString(),
    sessionId: pickString(body, 'sessionId', 120),
    clientTimestamp: pickString(body, 'clientTimestamp', 80),
    url: pickString(body, 'url', 500),
    referrer: pickString(body, 'referrer', 500),

    dates: sanitizeValue(
      body.dates || {
        start: body.startDate || null,
        end: body.endDate || null
      }
    ),

    currentArea: pickString(body, 'currentArea', 120) || pickString(body, 'area', 120),
    areaName: pickString(body, 'areaName', 180),
    label: pickString(body, 'label', 180),
    itemId: pickString(body, 'itemId', 120),
    productName: pickString(body, 'productName', 220),
    cellType: pickString(body, 'cellType', 80),
    cellNumber: pickString(body, 'cellNumber', 80),

    widgetState: pickString(body, 'widgetState', 80),
    cartItemsCount: Number.isFinite(Number(body.cartItemsCount))
      ? Number(body.cartItemsCount)
      : null,
    cartProductIds: Array.isArray(body.cartProductIds)
      ? body.cartProductIds.slice(0, 40).map((id) => truncateString(String(id), 80))
      : [],
    hasSavedCheckfrontCart: Boolean(body.hasSavedCheckfrontCart),

    viewport: sanitizeValue(body.viewport || null),
    userAgent: truncateString(body.userAgent || req.headers['user-agent'] || null, 500),
    touch: Boolean(body.touch),
    mobileish: Boolean(body.mobileish),
    visibilityState: pickString(body, 'visibilityState', 80),

    journey: sanitizeValue(body.journey || []),
    extra: sanitizeValue(body.extra || {})
  };
}

function getPrimaryCartItems(safeEvent) {
  const extra = safeEvent && safeEvent.extra ? safeEvent.extra : {};

  if (Array.isArray(extra.primaryCartItems)) {
    return extra.primaryCartItems.filter(Boolean);
  }

  if (Array.isArray(extra.cartPayload)) {
    return extra.cartPayload
      .filter((item) => item && String(item.sku || '').toLowerCase() !== 'shavings')
      .map(sanitizeCartItem)
      .filter(Boolean);
  }

  return [];
}

function summarizeForSheet(safeEvent) {
  const primaryItems = getPrimaryCartItems(safeEvent);

  const lastJourney = Array.isArray(safeEvent.journey)
    ? safeEvent.journey
        .slice(-5)
        .map((step) => {
          const event = step && step.event ? step.event : '';
          const label = step && step.label ? step.label : '';
          return label ? `${event}:${label}` : event;
        })
        .filter(Boolean)
        .join(' > ')
    : '';

  const viewport = safeEvent.viewport
    ? `${safeEvent.viewport.width || ''}x${safeEvent.viewport.height || ''}@${safeEvent.viewport.devicePixelRatio || ''}`
    : '';

  return {
    secret: JOURNEY_SHEETS_SECRET,
    receivedAt: safeEvent.receivedAt,
    sessionId: safeEvent.sessionId || '',
    event: safeEvent.event || '',
    dates: `${safeEvent.dates && safeEvent.dates.start ? safeEvent.dates.start : ''} to ${
      safeEvent.dates && safeEvent.dates.end ? safeEvent.dates.end : ''
    }`,
    area: safeEvent.currentArea || safeEvent.areaName || '',
    selectedLabel: safeEvent.label || '',
    selectedItemId: safeEvent.itemId || '',
    selectedProductName: safeEvent.productName || '',
    widgetState: safeEvent.widgetState || '',
    cartItemsCount: safeEvent.cartItemsCount || 0,
    primaryCartCount: primaryItems.length,
    primaryCartLabels: primaryItems
      .map((item) => item.productName || item.sku || item.product_id || '')
      .filter(Boolean)
      .join(' | '),
    primaryCartProductIds: primaryItems
      .map((item) => item.product_id || item.item_id || '')
      .filter(Boolean)
      .join(' | '),
    hasSavedCheckfrontCart: !!safeEvent.hasSavedCheckfrontCart,
    lastJourney,
    deviceType: safeEvent.mobileish ? 'mobile-ish' : 'desktop-ish',
    viewport,
    browser: parseBrowser(safeEvent.userAgent || ''),
    os: parseOS(safeEvent.userAgent || ''),
    url: safeEvent.url || '',
    extraSummary: summarizeExtra(safeEvent)
  };
}

function parseBrowser(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'Unknown';
}

function parseOS(ua) {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS/iPadOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

function summarizeExtra(safeEvent) {
  const extra = safeEvent.extra || {};
  const parts = [];

  if (extra.storage) parts.push(`storage=${extra.storage}`);
  if (extra.mode) parts.push(`mode=${extra.mode}`);
  if (extra.cartLength !== undefined) parts.push(`cartLength=${extra.cartLength}`);
  if (extra.sessionItemCount !== undefined) parts.push(`sessionItemCount=${extra.sessionItemCount}`);
  if (extra.available !== undefined) parts.push(`available=${extra.available}`);
  if (extra.hasSlip !== undefined) parts.push(`hasSlip=${extra.hasSlip}`);
  if (extra.priceTotal) parts.push(`priceTotal=${extra.priceTotal}`);
  if (extra.error) parts.push(`error=${String(extra.error).slice(0, 120)}`);

  return parts.join('; ');
}

async function sendToSheet(safeEvent) {
  if (!JOURNEY_SHEETS_WEBHOOK_URL) return;
  if (!JOURNEY_SHEETS_SECRET) return;
  if (!safeEvent) return;

  const row = summarizeForSheet(safeEvent);

  try {
    await fetch(JOURNEY_SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(row)
    });
  } catch (err) {
    // Logging must never affect booking.
    console.warn('[CTA_JOURNEY_SHEET_ERROR]', err && err.message ? err.message : err);
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const body = isPlainObject(req.body) ? req.body : {};
    const safeEvent = sanitizeEvent(body, req);

    if (safeEvent) {
      console.log(`[CTA_JOURNEY] ${JSON.stringify(safeEvent)}`);

      // Best-effort durable logging. Do not delay or fail the booking app because of Sheets.
      sendToSheet(safeEvent).catch(() => {});
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    try {
      console.log(
        `[CTA_JOURNEY] ${JSON.stringify({
          prefix: 'CTA_JOURNEY',
          event: 'LOG_ENDPOINT_ERROR',
          receivedAt: new Date().toISOString(),
          message: err && err.message ? err.message : 'unknown log endpoint error'
        })}`
      );
    } catch (_) {}

    // Never return a 500 from logging. Booking flow should not care if logging failed.
    return res.status(200).json({ ok: true });
  }
};
