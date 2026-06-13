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

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function absorbOAuthSessionFromUrl() {
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
  return ['admin', 'superadmin', 'super_admin'].includes(normalizeRole(role));
}

function isUserPortalAllowed(role) {
  return ['user', 'operator', 'admin', 'superadmin', 'super_admin'].includes(normalizeRole(role));
}

function profileRole(profile, source = '') {
  if (!profile) return 'user';

  const role =
    profile.role ||
    profile.access_role ||
    profile.user_role ||
    profile.permission ||
    profile.level ||
    profile.status_role;

  if (role) return normalizeRole(role);
  if (source === 'admin') return 'admin';
  return 'user';
}

function prepareProfile(row, source) {
  if (!row) return null;
  return { ...row, _source: source, role: profileRole(row, source) };
}

async function tryProfileByEmail(tableName, email, source) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) return null;

  // 1) Основний сценарій: адмінка створює запис у rebus_profiles.email.
  // ilike прибирає проблему регістру літер у Google email.
  const { data, error } = await supabaseClient
    .from(tableName)
    .select('*')
    .ilike('email', cleanEmail)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`[REBUS] ${tableName} email lookup error:`, error.message);
    return null;
  }

  return prepareProfile(data, source);
}

async function tryProfileById(tableName, userId, source) {
  if (!userId) return null;

  // Додаткова страховка: якщо в майбутньому id профілю дорівнюватиме auth.users.id.
  const { data, error } = await supabaseClient
    .from(tableName)
    .select('*')
    .eq('id', userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`[REBUS] ${tableName} id lookup skipped:`, error.message);
    return null;
  }

  return prepareProfile(data, source);
}

async function fetchProfile(userOrEmail) {
  const email = typeof userOrEmail === 'string' ? userOrEmail : userOrEmail?.email;
  const userId = typeof userOrEmail === 'string' ? null : userOrEmail?.id;

  const profileTable = cfg.PROFILE_TABLE || 'rebus_profiles';
  const adminTable = cfg.ADMIN_TABLE || 'rebus_admin_access';

  // Головне джерело прав для користувацького порталу.
  let profile = await tryProfileByEmail(profileTable, email, 'profile');
  if (profile) return profile;

  profile = await tryProfileById(profileTable, userId, 'profile');
  if (profile) return profile;

  // Fallback для існуючої адмінської таблиці, щоб адмін не втратив доступ,
  // якщо його ще не перенесли в rebus_profiles.
  profile = await tryProfileByEmail(adminTable, email, 'admin');
  if (profile) return profile;

  profile = await tryProfileById(adminTable, userId, 'admin');
  if (profile) return profile;

  return null;
}

function isActiveProfile(profile) {
  if (!profile) return false;
  if (profile.deleted_at) return false;

  const status = String(profile.status || '').trim().toLowerCase();
  const inactiveStatuses = ['deleted', 'inactive', 'disabled', 'blocked', 'rejected', 'denied'];

  if (inactiveStatuses.includes(status)) return false;
  if (profile.is_active === false) return false;

  // Якщо статус порожній або approved/active/new — не блокуємо.
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

  const profile = await fetchProfile(session.user);

  if (!isActiveProfile(profile) || !isUserPortalAllowed(profile?.role)) {
    // Не затираємо Google-сесію. Так легше повернутись після надання доступу
    // і зручніше діагностувати, який email не знайдений у rebus_profiles.
    sessionStorage.setItem('rebus_denied_email', session.user.email || '');
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

  // Користувацький сайт ніколи не перекидає адміна автоматично в адмінку.
  location.href = aal === 'aal2' ? userPortalAfter2FaUrl() : 'verify-2fa.html';
}

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
  normalizeEmail,
  normalizeRole,
  roleLabel,
  isAdminRole,
  isUserPortalAllowed,
  startGoogleLogin,
  routeIfAlreadyLoggedIn,
  userPortalAfter2FaUrl,
  user2FaUrl
};
