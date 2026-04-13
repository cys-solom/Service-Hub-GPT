/**
 * Service Hub — GPT Subscription
 * Main Application Logic
 * 
 * Flow:
 *  1. User enters CDK code → POST /cdk-activation/check
 *  2. If valid & unused → show plan info, proceed to step 2
 *  3. User provides session token or email → POST /cdk-activation/outstock
 *  4. If async (task_id) → poll GET /cdk-activation/tasks/{taskId}
 *  5. Show success or error
 */

// ─── API Configuration ────────────────────────────
// On Vercel: /api/* is proxied to ai-redeem.cc (no CORS issues)
// Locally or elsewhere: falls back to direct API + CORS proxies
const DIRECT_API = 'https://ai-redeem.cc';
const PROXY_PREFIX = '/api/proxy?path=';  // Vercel serverless function

const CORS_PROXIES = [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
];

// ─── DOM References ────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const cdkInput = $('#cdk-input');
const pasteCdkBtn = $('#paste-cdk-btn');
const checkBtn = $('#check-btn');
const cdkAlert = $('#cdk-alert');
const cdkInfo = $('#cdk-info');
const nextStep2Btn = $('#next-step-2-btn');

const sessionInput = $('#session-input');
const sessionAlert = $('#session-alert');
const activateBtn = $('#activate-btn');
const backStep1Btn = $('#back-step-1-btn');

const statusProcessing = $('#status-processing');
const statusSuccess = $('#status-success');
const statusFailed = $('#status-failed');
const statusMessage = $('#status-message');
const progressFill = $('#progress-fill');
const successMessage = $('#success-message');
const successDetails = $('#success-details');
const failedMessage = $('#failed-message');
const newActivationBtn = $('#new-activation-btn');
const retryBtn = $('#retry-btn');
const restartBtn = $('#restart-btn');

// ─── State ─────────────────────────────────────
let currentStep = 1;
let cdkCode = '';
let cdkData = null;  // stores the check response
let authMethod = 'session';
let pollingInterval = null;
let pollingTimeout = null;

// ─── Smart API Layer ───────────────────────────
// Tries: 1) Direct API  2) Vercel proxy  3) CORS proxies
// Remembers which method works for subsequent calls

let workingMethod = null; // 'direct', 'proxy', 'cors-0', 'cors-1', etc.

// Known API response fields — used to validate real API responses vs proxy errors
const API_KNOWN_FIELDS = ['used', 'status', 'app_name', 'app_product_name', 'key', 'task_id', 'pending', 'success', 'activation_type', 'code'];

function isRealApiResponse(json) {
    if (!json || typeof json !== 'object') return false;
    // If it has any known API field, it's a real response
    if (API_KNOWN_FIELDS.some(f => f in json)) return true;
    // If it's an array (batch check response), it's real
    if (Array.isArray(json)) return true;
    // If it has "message" with known API error text, it's real
    if (json.message && (json.message.includes('not found') || json.message.includes('failed'))) return true;
    return false;
}

async function fetchFromUrl(url, options, isProxy = false) {
    // Add timeout to each request
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }

    if (isProxy) {
        if (!res.ok) throw new Error(`Proxy returned HTTP ${res.status}`);
        if (!json) throw new Error('Proxy returned non-JSON');
        if (!isRealApiResponse(json)) throw new Error(`Proxy error: ${json.message || text.substring(0, 100)}`);
        return json;
    }

    if (json && isRealApiResponse(json)) return json;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    if (!json) throw new Error('Non-JSON response');
    return json;
}

async function apiRequest(method, endpoint, body = null) {
    const fetchOpts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body && method !== 'GET') {
        fetchOpts.body = JSON.stringify(body);
    }

    // If we already know what works, try ONLY that (fast path for polling)
    if (workingMethod) {
        const saved = buildAttempt(workingMethod, endpoint);
        if (saved) {
            try {
                const data = await fetchFromUrl(saved.url, fetchOpts, saved.isProxy);
                return data;
            } catch (err) {
                console.warn(`[API] Cached method ${workingMethod} failed:`, err.message);
                workingMethod = null; // Reset and try all
            }
        }
    }

    // Try all methods: proxy first, then direct, then CORS
    const attempts = [
        { label: 'proxy', url: `${PROXY_PREFIX}${endpoint}`, isProxy: false },
        { label: 'direct', url: `${DIRECT_API}${endpoint}`, isProxy: false },
    ];
    CORS_PROXIES.forEach((p, i) => {
        attempts.push({ label: `cors-${i}`, url: `${p}${encodeURIComponent(`${DIRECT_API}${endpoint}`)}`, isProxy: true });
    });

    let lastError = null;
    for (const attempt of attempts) {
        try {
            console.log(`[API] Trying ${attempt.label}...`);
            const data = await fetchFromUrl(attempt.url, fetchOpts, attempt.isProxy);
            workingMethod = attempt.label;
            return data;
        } catch (err) {
            console.warn(`[API] ✗ ${attempt.label}:`, err.message);
            lastError = err;
        }
    }

    throw lastError || new Error('Unable to connect to the server. Please try again.');
}

function buildAttempt(label, ep) {
    if (label === 'direct') return { label, url: `${DIRECT_API}${ep}`, isProxy: false };
    if (label === 'proxy') return { label, url: `${PROXY_PREFIX}${ep}`, isProxy: false };
    if (label.startsWith('cors-')) {
        const idx = parseInt(label.split('-')[1]);
        return { label, url: `${CORS_PROXIES[idx]}${encodeURIComponent(`${DIRECT_API}${ep}`)}`, isProxy: true };
    }
    return null;
}

function apiPost(endpoint, body) {
    return apiRequest('POST', endpoint, body);
}

function apiGet(endpoint) {
    return apiRequest('GET', endpoint);
}

// ─── Alert Helpers ─────────────────────────────
function showAlert(el, type, message) {
    el.className = `alert alert-${type}`;
    el.textContent = message;
    el.classList.remove('hidden');
}

function hideAlert(el) {
    el.classList.add('hidden');
}

// ─── Step Navigation ───────────────────────────
function goToStep(step) {
    currentStep = step;

    // Update step indicators
    $$('.step').forEach((s) => {
        const sNum = parseInt(s.dataset.step);
        s.classList.remove('active', 'completed');
        if (sNum === step) s.classList.add('active');
        if (sNum < step) s.classList.add('completed');
    });

    // Update step line fills
    const lines = $$('.step-line-fill');
    lines.forEach((line, idx) => {
        line.style.width = step > idx + 1 ? '100%' : '0%';
    });

    // Show correct content
    $$('.step-content').forEach((c) => c.classList.remove('active'));
    $(`#step-${step}`).classList.add('active');
}

// ─── Button Loading State ──────────────────────
function setLoading(btn, loading) {
    if (loading) {
        btn.classList.add('loading');
        btn.disabled = true;
        btn.querySelector('.btn-loader')?.classList.remove('hidden');
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
        btn.querySelector('.btn-loader')?.classList.add('hidden');
    }
}

// ─── Step 1: Check CDK Code ────────────────────
async function checkCDK() {
    const code = cdkInput.value.trim();
    if (!code) {
        showAlert(cdkAlert, 'error', 'Please enter a Hub-Code.');
        return;
    }

    hideAlert(cdkAlert);
    cdkInfo.classList.add('hidden');
    nextStep2Btn.classList.add('hidden');
    setLoading(checkBtn, true);

    try {
        const data = await apiPost('/cdk-activation/check', { code });

        if (data.message) {
            // Error - code not found
            showAlert(cdkAlert, 'error', data.message === 'cdk not found' ? 'Hub-Code not found. Please check and try again.' : data.message);
            setLoading(checkBtn, false);
            return;
        }

        if (data.used) {
            const email = data.key?.activated_email || 'an account';
            const status = data.key?.status || 'activated';
            showAlert(cdkAlert, 'warning', `This code has already been ${status} for ${email}.`);
            setLoading(checkBtn, false);
            return;
        }

        // Valid & unused
        cdkCode = code;
        cdkData = data;

        // Populate info card
        $('#info-plan').textContent = (data.key?.plan || data.app_name || 'N/A').toUpperCase();
        $('#info-product').textContent = data.app_product_name || data.app_name || 'N/A';
        $('#info-status').innerHTML = `<span style="color: var(--accent)">✓ ${data.status || 'Available'}</span>`;
        $('#info-type').textContent = (data.key?.key_type || 'N/A').charAt(0).toUpperCase() + (data.key?.key_type || 'N/A').slice(1);

        cdkInfo.classList.remove('hidden');
        checkBtn.classList.add('hidden');
        nextStep2Btn.classList.remove('hidden');

    } catch (err) {
        console.error('CDK Check Error:', err);
        showAlert(cdkAlert, 'error', `Connection error: ${err.message || 'Unable to reach the server. Please try again.'}`);
    }

    setLoading(checkBtn, false);
}

// ─── Token Validation & Account Info ─────────────
function decodeJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(payload));
    } catch { return null; }
}

function normalizePlanName(raw) {
    if (!raw) return null;
    const s = String(raw).toLowerCase().trim();
    if (s.includes('chatgptpro') || s === 'pro') return 'Pro';
    if (s.includes('chatgptplus') || s.includes('plus')) return 'Plus';
    if (s.includes('team')) return 'Team';
    if (s.includes('enterprise')) return 'Enterprise';
    if (s.includes('free') || s === '' || s === 'none') return 'Free';
    // Return capitalized if unknown
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function extractPlanFromSession(session, jwt) {
    let plan = null;
    let isWorkspace = false;

    // ── 1. Check session.accounts (newest format) ──
    // Structure: session.accounts = { "acc-id": { account: { plan_type: "..." }, ... } }
    if (session.accounts && typeof session.accounts === 'object') {
        for (const key of Object.keys(session.accounts)) {
            const acc = session.accounts[key];
            if (acc?.account?.plan_type) {
                plan = normalizePlanName(acc.account.plan_type);
            }
            if (acc?.account?.account_user_role === 'member' || 
                acc?.account?.structure === 'workspace' ||
                acc?.account?.is_org_account === true) {
                isWorkspace = true;
            }
            // Check entitlement
            if (acc?.entitlement?.plan) {
                plan = normalizePlanName(acc.entitlement.plan);
            }
            if (acc?.features && Array.isArray(acc.features)) {
                if (acc.features.includes('workspace')) isWorkspace = true;
            }
        }
    }

    // ── 2. Check session.account (older format) ──
    if (!plan && session.account) {
        if (session.account.plan_type) plan = normalizePlanName(session.account.plan_type);
        if (session.account.planType) plan = normalizePlanName(session.account.planType);
        if (session.account.plan) plan = normalizePlanName(session.account.plan);
    }

    // ── 3. Check session-level plan fields ──
    if (!plan && session.accountPlan) plan = normalizePlanName(session.accountPlan);
    if (!plan && session.plan_type) plan = normalizePlanName(session.plan_type);
    if (!plan && session.plan) plan = normalizePlanName(session.plan);

    // ── 4. Check JWT claims ──
    if (jwt) {
        const profile = jwt['https://api.openai.com/profile'] || {};
        const auth = jwt['https://api.openai.com/auth'] || {};

        // Workspace detection from JWT
        if (auth.organization_id || auth.org_id || auth.workspace_id) isWorkspace = true;
        if (profile.organization_id || profile.org_id) isWorkspace = true;

        // Plan from JWT claims
        if (!plan && auth.plan) plan = normalizePlanName(auth.plan);
        if (!plan && profile.plan) plan = normalizePlanName(profile.plan);

        // Scopes-based detection
        if (!plan) {
            const scopes = jwt.scope || '';
            if (scopes.includes('model.request.gpt-4')) {
                plan = 'Plus';
            }
        }

        // Audience-based workspace detection
        const aud = Array.isArray(jwt.aud) ? jwt.aud : [jwt.aud || ''];
        if (aud.some(a => a && (a.includes('workspace') || a.includes('enterprise') || a.includes('team')))) {
            isWorkspace = true;
        }
    }

    // ── 5. Check user groups for workspace ──
    const groups = session.user?.groups || [];
    if (groups.some(g => typeof g === 'string' && (g.includes('team') || g.includes('workspace') || g.includes('enterprise')))) {
        isWorkspace = true;
    }

    // Normalize workspace plans
    if (plan === 'Team' || plan === 'Enterprise') isWorkspace = true;

    return { plan: plan || 'Free', isWorkspace };
}

function validateAndShowToken(raw) {
    const accountInfo = document.getElementById('account-info');
    const accountEmail = document.getElementById('account-email');
    const accountPlan = document.getElementById('account-plan');

    accountInfo.classList.add('hidden');

    // 1. Parse JSON
    let session;
    try {
        session = JSON.parse(raw);
    } catch {
        return { valid: false, error: 'Invalid JSON format. Please paste the full session response from chatgpt.com/api/auth/session' };
    }

    // 2. Check required fields
    if (!session.accessToken) {
        return { valid: false, error: 'Missing "accessToken" field. Make sure you copied the full response from chatgpt.com/api/auth/session' };
    }

    if (!session.user || !session.user.email) {
        return { valid: false, error: 'Missing user email. The session token appears incomplete or corrupted.' };
    }

    // 3. Decode JWT & check expiration
    const jwt = decodeJWT(session.accessToken);
    if (jwt && jwt.exp && jwt.exp * 1000 < Date.now()) {
        return { valid: false, error: 'Session token has expired. Please get a fresh token from chatgpt.com/api/auth/session' };
    }

    // 4. Extract plan from ALL possible locations
    const { plan: currentPlan, isWorkspace } = extractPlanFromSession(session, jwt);

    console.log('[TOKEN] Email:', session.user.email, '| Plan:', currentPlan, '| Workspace:', isWorkspace);

    // 5. Block workspace accounts
    if (isWorkspace) {
        return { 
            valid: false, 
            error: '⚠️ Workspace / Team accounts are not supported. Please use a personal ChatGPT account for activation.' 
        };
    }

    // 6. Show account info
    accountEmail.textContent = session.user.email;
    accountPlan.textContent = currentPlan;

    // Style the plan text
    if (currentPlan === 'Plus') {
        accountPlan.style.color = '#FFA726';
    } else if (currentPlan === 'Pro') {
        accountPlan.style.color = '#a855f7';
    } else if (currentPlan === 'Free') {
        accountPlan.style.color = '#8b8b9e';
    } else {
        accountPlan.style.color = 'var(--accent)';
    }

    accountInfo.classList.remove('hidden');

    return { valid: true, session, email: session.user.email, plan: currentPlan };
}

// ─── Step 2: Activate ──────────────────────────
async function activate() {
    const raw = sessionInput.value.trim();
    if (!raw) {
        showAlert(sessionAlert, 'error', 'Please paste your session token.');
        return;
    }

    // Validate token
    const tokenResult = validateAndShowToken(raw);
    if (!tokenResult.valid) {
        showAlert(sessionAlert, 'error', tokenResult.error);
        return;
    }

    // ─── Plan Compatibility Checks ───
    const currentPlan = tokenResult.plan;
    const codePlan = (cdkData?.key?.plan || cdkData?.app_name || '').toLowerCase();

    // Block: Pro code + Plus account (won't work)
    if (codePlan.includes('pro') && currentPlan === 'Plus') {
        showAlert(sessionAlert, 'error', 
            '⛔ Cannot activate a Pro subscription while Plus is active. Please wait until your Plus subscription expires, or use a different account.');
        return;
    }

    // Block: Plus code + Pro account (downgrade not supported)
    if (codePlan.includes('plus') && currentPlan === 'Pro') {
        showAlert(sessionAlert, 'error', 
            '⛔ Cannot activate a Plus subscription while Pro is active. Please wait until your Pro subscription expires, or use a different account.');
        return;
    }

    // Warn: Plus code + Plus account (cycle will restart)
    if (codePlan.includes('plus') && currentPlan === 'Plus') {
        const proceed = confirm(
            '⚠️ Your account already has an active Plus subscription.\n\n' +
            'Activating this Hub Code will start a NEW subscription cycle.\n' +
            'The remaining days of your current cycle will be lost.\n\n' +
            'Do you want to continue?'
        );
        if (!proceed) return;
    }

    // Warn: Pro code + Pro account (cycle will restart)
    if (codePlan.includes('pro') && currentPlan === 'Pro') {
        const proceed = confirm(
            '⚠️ Your account already has an active Pro subscription.\n\n' +
            'Activating this Hub Code will start a NEW subscription cycle.\n' +
            'The remaining days of your current cycle will be lost.\n\n' +
            'Do you want to continue?'
        );
        if (!proceed) return;
    }

    hideAlert(sessionAlert);
    setLoading(activateBtn, true);

    try {
        console.log('[ACTIVATE] Sending activation request...');
        const data = await apiPost('/cdk-activation/outstock', {
            cdk: cdkCode,
            user: raw,
        });
        console.log('[ACTIVATE] Response:', JSON.stringify(data));

        // Handle specific error responses from API
        if (data.message && !data.task_id && !data.success) {
            const msg = data.message.toLowerCase();
            let userMsg = data.message;
            
            // Translate common API errors
            if (msg.includes('session') && (msg.includes('invalid') || msg.includes('expired'))) {
                userMsg = 'Session token is invalid or expired. Please get a fresh token from chatgpt.com/api/auth/session';
            } else if (msg.includes('workspace') || msg.includes('team account') || msg.includes('organization')) {
                userMsg = '⚠️ Workspace / Team accounts are not supported. Please use a personal ChatGPT account.';
            } else if (msg.includes('already') || msg.includes('activated') || msg.includes('used')) {
                userMsg = 'This Hub Code has already been activated.';
            } else if (msg.includes('not found') || msg.includes('invalid')) {
                userMsg = 'Invalid Hub Code. Please check and try again.';
            } else if (msg.includes('failed') || msg.includes('error')) {
                userMsg = 'Activation failed: ' + data.message;
            }
            
            showAlert(sessionAlert, 'error', userMsg);
            setLoading(activateBtn, false);
            return;
        }

        // Move to step 3 (progress)
        goToStep(3);

        if (data.task_id) {
            // Async activation — poll for status
            console.log('[ACTIVATE] Async task started:', data.task_id);
            startPolling(data.task_id);
        } else if (data.pending === false && data.success === true) {
            // Immediate success
            showSuccess(data);
        } else if (data.pending === false && data.success === false) {
            // Immediate failure
            showFailed(data.message || 'Activation failed.');
        } else if (data.success === true) {
            // Success without pending field
            showSuccess(data);
        } else {
            // Unknown response format — try polling with the CDK code
            console.warn('[ACTIVATE] Unknown response format, trying poll:', data);
            startPolling(data.task_id || cdkCode);
        }

    } catch (err) {
        console.error('Activation Error:', err);
        showAlert(sessionAlert, 'error', `Connection error: ${err.message || 'Unable to reach the server. Please try again.'}`);
    }

    setLoading(activateBtn, false);
}

// ─── Step 3: Polling ───────────────────────────
function startPolling(taskId) {
    let progress = 10;
    let pollCount = 0;
    const MAX_POLLS = 40; // ~2 minutes at 3s intervals

    statusProcessing.classList.remove('hidden');
    statusSuccess.classList.add('hidden');
    statusFailed.classList.add('hidden');
    statusMessage.textContent = 'Processing your request...';
    progressFill.style.width = '10%';

    pollingInterval = setInterval(async () => {
        pollCount++;
        try {
            const data = await apiGet(`/cdk-activation/tasks/${taskId}`);
            console.log(`[POLL #${pollCount}]`, JSON.stringify(data));

            // Update progress bar
            if (progress < 85) {
                progress += Math.random() * 15;
                progressFill.style.width = `${Math.min(progress, 85)}%`;
            }

            // Update status message
            if (data.message) {
                statusMessage.textContent = formatStatusMessage(data.status, data.message);
            }

            // Check completion: handle both boolean 'pending' and string 'status'
            const isDone = data.pending === false 
                || data.status === 'done' 
                || data.status === 'subscription_sent'
                || data.status === 'error'
                || data.status === 'failed';

            if (isDone) {
                clearInterval(pollingInterval);
                pollingInterval = null;
                if (pollingTimeout) { clearTimeout(pollingTimeout); pollingTimeout = null; }

                const isSuccess = data.success === true 
                    || data.status === 'done' 
                    || data.status === 'subscription_sent'
                    || (data.message && data.message.toLowerCase().includes('success'));

                if (isSuccess) {
                    progressFill.style.width = '100%';
                    setTimeout(() => showSuccess(data), 500);
                } else {
                    showFailed(data.message || 'Activation failed.');
                }
                return;
            }
        } catch (err) {
            console.warn(`[POLL #${pollCount}] Error:`, err.message);
            statusMessage.textContent = 'Reconnecting...';
        }

        // Timeout: after MAX_POLLS, check code status directly
        if (pollCount >= MAX_POLLS) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            statusMessage.textContent = 'Checking final status...';
            try {
                const check = await apiPost('/cdk-activation/check', { code: cdkCode });
                if (check.used === true) {
                    progressFill.style.width = '100%';
                    showSuccess({ 
                        success: true, 
                        message: 'Subscription activated successfully!',
                        key: check.key,
                        activation_type: 'new'
                    });
                } else {
                    showFailed('Activation timed out. Please check your ChatGPT account or try again.');
                }
            } catch {
                showFailed('Connection lost. Please check your ChatGPT account manually.');
            }
        }
    }, 3000);
}

function formatStatusMessage(status, message) {
    const messages = {
        'account_found': '🔍 Account found, processing...',
        'subscription_sent': '✅ Subscription sent!',
        'processing': '⏳ Processing activation...',
        'started': '🚀 Activation started...',
        'error': '❌ ' + message,
    };
    return messages[status] || message || 'Processing...';
}

function showSuccess(data) {
    statusProcessing.classList.add('hidden');
    statusSuccess.classList.remove('hidden');
    statusFailed.classList.add('hidden');

    successMessage.textContent = data.message || 'Your subscription has been activated successfully.';

    // Extract email from multiple sources
    let email = data.key?.activated_email || '';
    if (!email && data.message) {
        const m = data.message.match(/[\w.-]+@[\w.-]+\.\w+/);
        if (m) email = m[0];
    }
    if (!email) {
        try {
            const s = JSON.parse(sessionInput.value.trim());
            email = s.user?.email || s.email || '';
        } catch {}
    }

    // Get plan info from response or initial check data
    const plan = (data.key?.plan || cdkData?.key?.plan || '').toUpperCase();
    const term = data.key?.term || cdkData?.key?.term || '';
    const hours = data.key?.subscription_hours || cdkData?.key?.subscription_hours || 0;
    const duration = getDuration(term, hours);
    const type = data.activation_type === 'new' ? 'New Activation' 
               : data.activation_type === 'renew' ? 'Renewal' 
               : (data.activation_type || 'Activation');

    let detailsHTML = '';
    if (plan) detailsHTML += `<p><span>Plan</span><span>${plan}</span></p>`;
    if (email) detailsHTML += `<p><span>Email</span><span>${email}</span></p>`;
    if (duration) detailsHTML += `<p><span>Duration</span><span>${duration}</span></p>`;
    detailsHTML += `<p><span>Type</span><span>${type}</span></p>`;
    detailsHTML += `<p><span>Status</span><span style="color: var(--accent)">✓ Activated</span></p>`;
    successDetails.innerHTML = detailsHTML;

    // Log activation to database + Telegram
    logActivation(data);
}

function getDuration(term, hours) {
    if (term) {
        if (term.includes('30d') || term.includes('1m')) return '1 Month';
        if (term.includes('60d') || term.includes('2m')) return '2 Months';
        if (term.includes('90d') || term.includes('3m')) return '3 Months';
        if (term.includes('180d') || term.includes('6m')) return '6 Months';
        if (term.includes('365d') || term.includes('1y') || term.includes('12m')) return '1 Year';
        if (term.includes('7d') || term.includes('1w')) return '1 Week';
        const days = parseInt(term);
        if (days) return `${days} Days`;
    }
    if (hours) {
        if (hours >= 720) return `${Math.round(hours / 720)} Month${hours >= 1440 ? 's' : ''}`;
        if (hours >= 168) return `${Math.round(hours / 168)} Week${hours >= 336 ? 's' : ''}`;
        return `${Math.round(hours / 24)} Days`;
    }
    return '';
}

function logActivation(data) {
    // Extract email from: activation response → session token → message text
    let email = data.key?.activated_email || '';
    if (!email) {
        try {
            const session = JSON.parse(sessionInput.value.trim());
            email = session.user?.email || session.email || '';
        } catch {}
    }
    if (!email && data.message) {
        // Try to extract email from message like "Activated for name@example.com"
        const emailMatch = data.message.match(/[\w.-]+@[\w.-]+\.\w+/);
        if (emailMatch) email = emailMatch[0];
    }

    const payload = {
        email: email || 'unknown',
        code: cdkCode,
        plan: data.key?.plan || cdkData?.key?.plan || cdkData?.app_name || '',
        activation_type: data.activation_type || '',
        status: data.key?.status || 'activated',
    };

    // Fire and forget — don't block UI
    fetch('/api/log-activation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(r => {
        console.log('[LOG] Activation logged:', r.ok);
    }).catch(err => {
        console.warn('[LOG] Failed to log:', err.message);
    });
}

function showFailed(message) {
    statusProcessing.classList.add('hidden');
    statusSuccess.classList.add('hidden');
    statusFailed.classList.remove('hidden');
    failedMessage.textContent = message || 'Something went wrong. Please try again.';
}

// ─── Reset ─────────────────────────────────────
function resetAll() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }

    cdkCode = '';
    cdkData = null;
    cdkInput.value = '';
    sessionInput.value = '';

    hideAlert(cdkAlert);
    hideAlert(sessionAlert);
    document.getElementById('account-info').classList.add('hidden');
    cdkInfo.classList.add('hidden');
    checkBtn.classList.remove('hidden');
    nextStep2Btn.classList.add('hidden');

    statusProcessing.classList.remove('hidden');
    statusSuccess.classList.add('hidden');
    statusFailed.classList.add('hidden');

    goToStep(1);
}

// ─── Event Listeners ───────────────────────────
checkBtn.addEventListener('click', checkCDK);

cdkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkCDK();
});

pasteCdkBtn.addEventListener('click', async () => {
    try {
        const text = await navigator.clipboard.readText();
        cdkInput.value = text;
        cdkInput.focus();
    } catch {
        // Clipboard API not available
        cdkInput.focus();
    }
});

nextStep2Btn.addEventListener('click', () => goToStep(2));
backStep1Btn.addEventListener('click', () => {
    goToStep(1);
    // Show CDK info again if we already checked
    if (cdkData) {
        cdkInfo.classList.remove('hidden');
        checkBtn.classList.add('hidden');
        nextStep2Btn.classList.remove('hidden');
    }
});

// Auto-validate session token on paste/input
let tokenDebounce = null;
sessionInput.addEventListener('input', () => {
    clearTimeout(tokenDebounce);
    const raw = sessionInput.value.trim();
    if (!raw) {
        document.getElementById('account-info').classList.add('hidden');
        hideAlert(sessionAlert);
        return;
    }
    tokenDebounce = setTimeout(() => {
        const result = validateAndShowToken(raw);
        if (!result.valid) {
            showAlert(sessionAlert, 'error', result.error);
        } else {
            hideAlert(sessionAlert);
        }
    }, 500);
});

activateBtn.addEventListener('click', activate);

newActivationBtn.addEventListener('click', resetAll);
retryBtn.addEventListener('click', () => {
    goToStep(2);
    hideAlert(sessionAlert);
});
restartBtn.addEventListener('click', resetAll);

// Focus input on load
window.addEventListener('DOMContentLoaded', () => {
    cdkInput.focus();
});
