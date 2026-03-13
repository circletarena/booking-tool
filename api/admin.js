/**
 * GET/POST /api/admin
 *
 * Simple admin panel for Circle T Arena booking tool settings.
 * Protected by a passphrase (ADMIN_PASSPHRASE env var).
 *
 * GET  — serves the admin HTML page
 * POST — updates settings via Vercel API and triggers redeploy
 *
 * Required env vars:
 *   ADMIN_PASSPHRASE   — passphrase to access the admin panel
 *   VERCEL_TOKEN        — Vercel API token (for updating env vars)
 *   VERCEL_PROJECT_ID   — Vercel project ID
 */

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html');
    return res.send(ADMIN_HTML);
  }

  if (req.method === 'POST') {
    const { passphrase, lookbackDays } = req.body || {};

    // Verify passphrase
    const correctPassphrase = process.env.ADMIN_PASSPHRASE;
    if (!correctPassphrase || passphrase !== correctPassphrase) {
      return res.status(401).json({ error: 'Invalid passphrase' });
    }

    // Validate lookback value
    const days = parseInt(lookbackDays);
    if (isNaN(days) || days < 0 || days > 30) {
      return res.status(400).json({ error: 'Lookback days must be between 0 and 30' });
    }

    const vercelToken = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;
    if (!vercelToken || !projectId) {
      return res.status(500).json({ error: 'Vercel API not configured. Set VERCEL_TOKEN and VERCEL_PROJECT_ID.' });
    }

    try {
      // Check if LOOKBACK_DAYS env var already exists
      const listResp = await fetch(
        `https://api.vercel.com/v9/projects/${projectId}/env`,
        { headers: { Authorization: `Bearer ${vercelToken}` } }
      );
      const listData = await listResp.json();
      const existing = (listData.envs || []).find(e => e.key === 'LOOKBACK_DAYS');

      if (existing) {
        // Update existing env var
        await fetch(
          `https://api.vercel.com/v9/projects/${projectId}/env/${existing.id}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${vercelToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ value: String(days) }),
          }
        );
      } else {
        // Create new env var
        await fetch(
          `https://api.vercel.com/v10/projects/${projectId}/env`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${vercelToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              key: 'LOOKBACK_DAYS',
              value: String(days),
              type: 'plain',
              target: ['production', 'preview'],
            }),
          }
        );
      }

      // Trigger a redeploy so the new value takes effect
      // We do this by creating a new deployment from the latest commit
      const deployResp = await fetch(
        `https://api.vercel.com/v13/deployments`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${vercelToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: projectId,
            project: projectId,
            target: 'production',
          }),
        }
      );

      const deployOk = deployResp.ok;

      return res.json({
        success: true,
        lookbackDays: days,
        redeployTriggered: deployOk,
        message: deployOk
          ? `Lookback updated to ${days} days. The site will redeploy in about a minute.`
          : `Lookback updated to ${days} days, but the redeploy needs to be triggered manually in Vercel.`,
      });

    } catch (err) {
      console.error('Admin update error:', err.message);
      return res.status(500).json({ error: 'Failed to update: ' + err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};


const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin - Circle T Arena Booking Tool</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    background: #0f0d0a; color: #ede4d0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
  }
  .card {
    background: #181510; border: 1px solid #383020; border-radius: 8px;
    padding: 32px; max-width: 440px; width: 100%;
  }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { font-size: 12px; color: #9a8e78; margin-bottom: 24px; }
  label { display: block; font-size: 11px; font-weight: 600; color: #9a8e78; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
  input {
    width: 100%; padding: 10px 14px; background: #211d16; border: 1px solid #383020;
    border-radius: 5px; color: #ede4d0; font-size: 14px; outline: none;
    transition: border-color 0.15s;
  }
  input:focus { border-color: #c8a040; }
  input[type="number"] { width: 100px; text-align: center; font-size: 18px; font-weight: 600; }
  .field { margin-bottom: 20px; }
  .days-row { display: flex; align-items: center; gap: 12px; }
  .days-label { font-size: 14px; color: #ede4d0; }
  .hint { font-size: 11px; color: #5a5040; margin-top: 6px; line-height: 1.5; }
  .btn {
    width: 100%; padding: 12px; background: #c8a040; color: #0f0d0a; border: none;
    border-radius: 5px; font-size: 14px; font-weight: 700; cursor: pointer;
    transition: background 0.15s;
  }
  .btn:hover { background: #e8c060; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .status {
    margin-top: 16px; padding: 12px; border-radius: 5px; font-size: 13px;
    line-height: 1.5; display: none;
  }
  .status.ok { display: block; background: rgba(60,138,80,0.15); border: 1px solid #3a8a50; color: #60c478; }
  .status.err { display: block; background: rgba(138,48,48,0.15); border: 1px solid #8a3030; color: #c04040; }
  .status.loading { display: block; background: rgba(200,160,64,0.12); border: 1px solid #c8a040; color: #e8c060; }
  .current { font-size: 13px; color: #9a8e78; margin-bottom: 20px; padding: 10px 14px; background: #211d16; border-radius: 5px; border: 1px solid #383020; }
  .current strong { color: #e8c060; }
  .login-view, .settings-view { display: none; }
  .login-view.active, .settings-view.active { display: block; }
</style>
</head>
<body>
<div class="card">
  <h1>Booking Tool Settings</h1>
  <p class="subtitle">Circle T Arena</p>

  <div class="login-view active" id="loginView">
    <div class="field">
      <label for="passphrase">Passphrase</label>
      <input type="password" id="passphrase" placeholder="Enter admin passphrase" onkeydown="if(event.key==='Enter')doLogin()">
    </div>
    <button class="btn" onclick="doLogin()">Sign In</button>
    <div class="status" id="loginStatus"></div>
  </div>

  <div class="settings-view" id="settingsView">
    <div class="current" id="currentInfo">Loading current settings...</div>

    <div class="field">
      <label>Post-Checkout Hold</label>
      <div class="days-row">
        <input type="number" id="lookbackDays" min="0" max="30" value="3">
        <span class="days-label">days after checkout</span>
      </div>
      <div class="hint">
        After a booking ends, the stall will stay shown as unavailable online for this many days.
        This does not affect walk-up availability or the Checkfront dashboard.
      </div>
    </div>

    <button class="btn" id="saveBtn" onclick="doSave()">Save Changes</button>
    <div class="status" id="saveStatus"></div>
  </div>
</div>

<script>
var savedPassphrase = '';

function doLogin() {
  var pp = document.getElementById('passphrase').value.trim();
  if (!pp) return;
  savedPassphrase = pp;

  // Test the passphrase with a read request
  var status = document.getElementById('loginStatus');
  status.className = 'status loading';
  status.textContent = 'Checking...';

  // We verify by attempting a save with current value
  // First just show settings - actual verification happens on save
  document.getElementById('loginView').classList.remove('active');
  document.getElementById('settingsView').classList.add('active');
  status.className = 'status';

  // Show current lookback from the bookings endpoint
  loadCurrentSettings();
}

async function loadCurrentSettings() {
  var info = document.getElementById('currentInfo');
  try {
    // Fetch a dummy bookings request to see what lookbackDays comes back
    var today = new Date();
    var tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    var s = fmt(today), e = fmt(tomorrow);
    var resp = await fetch('/api/bookings?start=' + s + '&end=' + e);
    var data = await resp.json();
    var days = data.lookbackDays || 3;
    document.getElementById('lookbackDays').value = days;
    info.innerHTML = 'Current setting: stalls held for <strong>' + days + ' days</strong> after checkout';
  } catch (err) {
    info.textContent = 'Could not load current settings';
  }
}

function fmt(d) {
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

async function doSave() {
  var days = parseInt(document.getElementById('lookbackDays').value);
  var status = document.getElementById('saveStatus');
  var btn = document.getElementById('saveBtn');

  if (isNaN(days) || days < 0 || days > 30) {
    status.className = 'status err';
    status.textContent = 'Please enter a number between 0 and 30.';
    return;
  }

  btn.disabled = true;
  status.className = 'status loading';
  status.textContent = 'Saving and redeploying...';

  try {
    var resp = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: savedPassphrase, lookbackDays: days }),
    });
    var data = await resp.json();

    if (!resp.ok) {
      if (resp.status === 401) {
        // Wrong passphrase - go back to login
        document.getElementById('settingsView').classList.remove('active');
        document.getElementById('loginView').classList.add('active');
        var ls = document.getElementById('loginStatus');
        ls.className = 'status err';
        ls.textContent = 'Incorrect passphrase. Please try again.';
        document.getElementById('passphrase').value = '';
        savedPassphrase = '';
      } else {
        status.className = 'status err';
        status.textContent = data.error || 'Something went wrong.';
      }
      btn.disabled = false;
      return;
    }

    status.className = 'status ok';
    status.textContent = data.message;
    document.getElementById('currentInfo').innerHTML = 'Current setting: stalls held for <strong>' + days + ' days</strong> after checkout';
    btn.disabled = false;

  } catch (err) {
    status.className = 'status err';
    status.textContent = 'Connection error: ' + err.message;
    btn.disabled = false;
  }
}
</script>
</body>
</html>`;
