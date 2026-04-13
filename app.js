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
const PROXY_PREFIX = '/api';  // Vercel rewrites (vercel.json)

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

const authSessionBtn = $('#auth-session-btn');
const authEmailBtn = $('#auth-email-btn');
const sessionInputGroup = $('#session-input-group');
const emailInputGroup = $('#email-input-group');
const sessionInput = $('#session-input');
const emailInput = $('#email-input');
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
let authMethod = 'session'; // 'session' or 'email'
let pollingInterval = null;

// ─── Smart API Layer ───────────────────────────
// Tries: 1) Vercel proxy  2) Direct API  3) CORS proxies
// Remembers which method works for subsequent calls

let workingMethod = null; // 'proxy', 'direct', 'cors-0', 'cors-1', etc.

async function tryFetch(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        let json;
        try { json = JSON.parse(text); } catch { json = null; }
        // API might return error messages with non-200 status — still valid JSON
        if (json) return json;
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.json();
}

async function apiRequest(method, endpoint, body = null) {
    const fetchOpts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body && method !== 'GET') {
        fetchOpts.body = JSON.stringify(body);
    }

    // Build ordered list of attempts
    const attempts = [];

    // If we already know what works, try that first
    if (workingMethod === 'proxy') {
        attempts.push({ label: 'proxy', url: `${PROXY_PREFIX}${endpoint}` });
    } else if (workingMethod === 'direct') {
        attempts.push({ label: 'direct', url: `${DIRECT_API}${endpoint}` });
    } else if (workingMethod?.startsWith('cors-')) {
        const idx = parseInt(workingMethod.split('-')[1]);
        attempts.push({ label: workingMethod, url: `${CORS_PROXIES[idx]}${encodeURIComponent(`${DIRECT_API}${endpoint}`)}` });
    }

    // Then add all methods as fallback
    attempts.push({ label: 'proxy', url: `${PROXY_PREFIX}${endpoint}` });
    attempts.push({ label: 'direct', url: `${DIRECT_API}${endpoint}` });
    CORS_PROXIES.forEach((proxy, i) => {
        attempts.push({ label: `cors-${i}`, url: `${proxy}${encodeURIComponent(`${DIRECT_API}${endpoint}`)}` });
    });

    // Deduplicate by label
    const seen = new Set();
    const uniqueAttempts = attempts.filter(a => {
        if (seen.has(a.label)) return false;
        seen.add(a.label);
        return true;
    });

    let lastError = null;
    for (const attempt of uniqueAttempts) {
        try {
            console.log(`[API] Trying ${attempt.label}: ${attempt.url}`);
            const data = await tryFetch(attempt.url, fetchOpts);
            workingMethod = attempt.label;
            console.log(`[API] ✓ Success via ${attempt.label}`);
            return data;
        } catch (err) {
            console.warn(`[API] ✗ ${attempt.label} failed:`, err.message);
            lastError = err;
        }
    }

    throw lastError || new Error('All connection methods failed. Please try again.');
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
        showAlert(cdkAlert, 'error', 'Please enter a CDK code.');
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
            showAlert(cdkAlert, 'error', data.message === 'cdk not found' ? 'CDK code not found. Please check and try again.' : data.message);
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

// ─── Step 2: Auth Method Toggle ────────────────
function switchAuthMethod(method) {
    authMethod = method;
    authSessionBtn.classList.toggle('active', method === 'session');
    authEmailBtn.classList.toggle('active', method === 'email');
    sessionInputGroup.classList.toggle('hidden', method !== 'session');
    emailInputGroup.classList.toggle('hidden', method !== 'email');
    hideAlert(sessionAlert);
}

// ─── Step 2: Activate ──────────────────────────
async function activate() {
    let userPayload;

    if (authMethod === 'session') {
        const raw = sessionInput.value.trim();
        if (!raw) {
            showAlert(sessionAlert, 'error', 'Please paste your session token.');
            return;
        }

        // Validate JSON
        try {
            const parsed = JSON.parse(raw);
            if (!parsed.accessToken) {
                showAlert(sessionAlert, 'error', 'Invalid session: missing "accessToken" field.');
                return;
            }
            // Send as stringified JSON (API expects it)
            userPayload = raw;
        } catch {
            showAlert(sessionAlert, 'error', 'Invalid JSON format. Please paste the full session response.');
            return;
        }
    } else {
        const email = emailInput.value.trim();
        if (!email || !email.includes('@')) {
            showAlert(sessionAlert, 'error', 'Please enter a valid email address.');
            return;
        }
        userPayload = email;
    }

    hideAlert(sessionAlert);
    setLoading(activateBtn, true);

    try {
        const data = await apiPost('/cdk-activation/outstock', {
            cdk: cdkCode,
            user: userPayload,
        });

        if (data.message && !data.task_id && !data.success) {
            showAlert(sessionAlert, 'error', data.message);
            setLoading(activateBtn, false);
            return;
        }

        // Move to step 3
        goToStep(3);

        if (data.task_id) {
            // Async - start polling
            startPolling(data.task_id);
        } else if (data.success) {
            // Immediate success
            showSuccess(data);
        } else if (data.pending === false && data.success === false) {
            // Immediate failure
            showFailed(data.message || 'Activation failed.');
        } else {
            // Unknown response, treat as pending with task_id = cdkCode
            startPolling(cdkCode);
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

    statusProcessing.classList.remove('hidden');
    statusSuccess.classList.add('hidden');
    statusFailed.classList.add('hidden');
    statusMessage.textContent = 'Processing your request...';
    progressFill.style.width = '10%';

    pollingInterval = setInterval(async () => {
        try {
            const data = await apiGet(`/cdk-activation/tasks/${taskId}`);

            // Update progress bar
            if (progress < 85) {
                progress += Math.random() * 15;
                progressFill.style.width = `${Math.min(progress, 85)}%`;
            }

            // Update status message
            if (data.message) {
                statusMessage.textContent = formatStatusMessage(data.status, data.message);
            }

            if (data.pending === false) {
                clearInterval(pollingInterval);
                pollingInterval = null;

                if (data.success) {
                    progressFill.style.width = '100%';
                    setTimeout(() => showSuccess(data), 500);
                } else {
                    showFailed(data.message || 'Activation failed.');
                }
            }
        } catch (err) {
            // Don't stop polling on network hiccups
            statusMessage.textContent = 'Reconnecting...';
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

    // Build details
    let detailsHTML = '';
    if (data.key) {
        detailsHTML += `<p><span>Plan</span><span>${(data.key.plan || cdkData?.key?.plan || '—').toUpperCase()}</span></p>`;
        detailsHTML += `<p><span>Email</span><span>${data.key.activated_email || '—'}</span></p>`;
        detailsHTML += `<p><span>Type</span><span>${data.activation_type === 'new' ? 'New Activation' : data.activation_type === 'renew' ? 'Renewal' : (data.activation_type || '—')}</span></p>`;
        detailsHTML += `<p><span>Status</span><span style="color: var(--accent)">${data.key.status || 'Activated'}</span></p>`;
    }
    successDetails.innerHTML = detailsHTML;
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
    emailInput.value = '';

    hideAlert(cdkAlert);
    hideAlert(sessionAlert);
    cdkInfo.classList.add('hidden');
    checkBtn.classList.remove('hidden');
    nextStep2Btn.classList.add('hidden');

    statusProcessing.classList.remove('hidden');
    statusSuccess.classList.add('hidden');
    statusFailed.classList.add('hidden');

    switchAuthMethod('session');
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

authSessionBtn.addEventListener('click', () => switchAuthMethod('session'));
authEmailBtn.addEventListener('click', () => switchAuthMethod('email'));

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
