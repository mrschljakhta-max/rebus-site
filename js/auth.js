const cfg = window.REBUS_CONFIG || {};
const supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const statusEl = () => $('status') || $('loginStatus');

function setStatus(text, type = '') {
  const el = statusEl();
  if (!el) return;
  el.textContent = text || '';
  el.className = `status ${type}`.trim();
}

async function getSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
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

  // Якщо профіль знайдено в адмінській таблиці, але роль не вказана явно,
  // трактуємо його як admin, щоб адмін мав доступ і до порталу користувача.
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

async function requireUser() {
  const session = await getSession();
  if (!session?.user?.email) {
    location.href = 'index.html';
    return null;
  }

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

async function startGoogleLogin() {
  const btn = $('loginBtn');
  try {
    if (btn) btn.disabled = true;
    setStatus('');
    const redirectTo = cfg.USER_2FA_URL || `${window.location.origin}/verify-2fa.html`;
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
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

  const profile = await fetchProfile(session.user.email);
  if (!isActiveProfile(profile) || !isUserPortalAllowed(profile.role)) return;

  const aal = await getAal();

  // ВАЖЛИВО: користувацький сайт ніколи не перекидає адміна в адмінку автоматично.
  // Якщо адмін зайшов на rebus-secure.com — він працює тут як користувач.
  location.href = aal === 'aal2' ? userPortalAfter2FaUrl() : 'verify-2fa.html';
}

window.rebusAuth = {
  supabase: supabaseClient,
  $,
  setStatus,
  getSession,
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
  userPortalAfter2FaUrl
};
