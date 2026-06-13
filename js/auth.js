const cfg = window.REBUS_CONFIG || {};
const supabaseKey = cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_ANON_KEY;
const supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, supabaseKey);

const $ = (id) => document.getElementById(id);
const statusEl = () => $('status') || $('loginStatus');

function setStatus(text, type = '') {
  const el = statusEl();
  if (!el) return;
  el.textContent = text || '';
  el.className = `status ${type}`.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function absorbOAuthSessionFromUrl() {
  // Supabase OAuth іноді повертає access_token у hash (#access_token=...).
  // На GitHub Pages/static hosting сесія не завжди встигає зберегтися до першої перевірки,
  // через що verify-2fa.html бачить "немає сесії" і кидає назад на стартову.
  const hash = window.location.hash || '';
  if (!hash.includes('access_token=')) return null;

  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');

  if (!access_token || !refresh_token) return null;

  const { data, error } = await supabaseClient.auth.setSession({
    access_token,
    refresh_token
  });

  if (error) throw error;

  // Прибираємо токени з адресного рядка, але залишаємо користувача на цій же сторінці.
  history.replaceState(null, document.title, window.location.pathname + window.location.search);
  return data.session;
}


async function getSession() {
  try {
    const urlSession = await absorbOAuthSessionFromUrl();
    if (urlSession) return urlSession;
  } catch (error) {
    setStatus(error?.message || 'Не вдалося зберегти Google-сесію.', 'error');
  }

  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

async function waitForSession(timeoutMs = 10000) {
  const started = Date.now();
  let session = await getSession();
  while (!session && Date.now() - started < timeoutMs) {
    await sleep(250);
    session = await getSession();
  }
  return session;
}

function normalizeRole(role) {
  return String(role || 'user').trim().toLowerCase();
}

function roleLabel(role) {
  const map = {
    superadmin: 'Суперадміністратор',
    admin: 'Адміністратор',
    operator: 'Оператор',
    user: 'Користувач'
  };
  return map[normalizeRole(role)] || role || 'Користувач';
}

function isAdminRole(role) {
  return ['admin', 'superadmin'].includes(normalizeRole(role));
}

function isUserPortalAllowed(role) {
  return ['user', 'operator', 'admin', 'superadmin'].includes(normalizeRole(role));
}

function profileRole(profile, source = '') {
  if (!profile) return 'user';
  const role = profile.role || profile.access_role || profile.user_role || profile.permission || profile.level;
  if (role) return normalizeRole(role);

  if (source === 'admin') return 'admin';
  return 'user';
}

async function fetchProfile(email) {
  if (!email) return null;

  try {
    const { data, error } = await supabaseClient
      .from(cfg.PROFILE_TABLE || 'rebus_profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (!error && data) return { ...data, _source: 'profile', role: profileRole(data, 'profile') };
  } catch (_) {}

  try {
    const { data, error } = await supabaseClient
      .from(cfg.ADMIN_TABLE || 'rebus_admin_access')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (!error && data) return { ...data, _source: 'admin', role: profileRole(data, 'admin') };
  } catch (_) {}

  return null;
}

function isActiveProfile(profile) {
  if (!profile) return false;
  if (profile.deleted_at) return false;
  const status = String(profile.status || '').toLowerCase();
  if (['deleted', 'inactive', 'disabled', 'blocked'].includes(status)) return false;
  if (profile.is_active === false) return false;
  return true;
}

async function requireSessionOnly() {
  const session = await waitForSession();
  if (!session?.user?.email) {
    location.href = 'index.html';
    return null;
  }
  return session;
}

async function requireUser() {
  const session = await requireSessionOnly();
  if (!session) return null;

  const profile = await fetchProfile(session.user.email);
  if (!isActiveProfile(profile) || !isUserPortalAllowed(profile.role)) {
    await supabaseClient.auth.signOut();
    location.href = 'access-denied.html';
    return null;
  }

  return { session, profile };
}

async function getAal() {
  const { data } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel || 'aal1';
}

async function getAuthenticatorFactors() {
  const { data, error } = await supabaseClient.auth.mfa.listFactors();
  if (error) return [];
  return (data?.totp || []).filter((f) => f.status === 'verified');
}

function userPortalAfter2FaUrl() {
  return cfg.USER_AFTER_2FA_URL || cfg.AFTER_2FA_URL || 'cabinet.html';
}

function user2FaUrl() {
  return cfg.USER_2FA_URL || `${window.location.origin}/verify-2fa.html`;
}

async function startGoogleLogin() {
  const btn = $('loginBtn');
  try {
    if (btn) btn.disabled = true;
    setStatus('');
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: user2FaUrl(),
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account'
        }
      }
    });
    if (error) throw error;
  } catch (error) {
    setStatus(error?.message || 'Не вдалося відкрити Google-вхід.', 'error');
    if (btn) btn.disabled = false;
  }
}

async function routeIfAlreadyLoggedIn() {
  const session = await getSession();
  if (!session?.user?.email) return;

  const aal = await getAal();

  // Користувацький сайт НІКОЛИ не перекидає адміна автоматично в адмінку.
  // Якщо адмін зайшов на rebus-secure.com — він проходить користувацький маршрут.
  location.href = aal === 'aal2' ? userPortalAfter2FaUrl() : 'verify-2fa.html';
}

// Додатковий страховочний редірект після OAuth: якщо Supabase повернув користувача
// на index.html із готовою сесією, примусово ведемо його на власну сторінку 2FA порталу.
supabaseClient.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session?.user?.email && /index\.html?$|\/$/.test(location.pathname)) {
    const aal = await getAal();
    location.href = aal === 'aal2' ? userPortalAfter2FaUrl() : 'verify-2fa.html';
  }
});

window.rebusAuth = {
  supabase: supabaseClient,
  $,
  setStatus,
  getSession,
  waitForSession,
  absorbOAuthSessionFromUrl,
  requireSessionOnly,
  fetchProfile,
  isActiveProfile,
  requireUser,
  getAal,
  getAuthenticatorFactors,
  normalizeRole,
  roleLabel,
  isAdminRole,
  isUserPortalAllowed,
  startGoogleLogin,
  routeIfAlreadyLoggedIn,
  userPortalAfter2FaUrl,
  user2FaUrl
};
