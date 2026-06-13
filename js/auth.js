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

function roleLabel(role) {
  const map = { superadmin:'Суперадміністратор', admin:'Адміністратор', operator:'Оператор', user:'Користувач' };
  return map[(role || '').toLowerCase()] || role || 'Користувач';
}

async function fetchProfile(email) {
  if (!email) return null;

  let profile = null;
  try {
    const { data, error } = await supabaseClient
      .from(cfg.PROFILE_TABLE || 'rebus_profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (!error && data) profile = data;
  } catch (_) {}

  if (!profile) {
    try {
      const { data, error } = await supabaseClient
        .from(cfg.ADMIN_TABLE || 'rebus_admin_access')
        .select('*')
        .eq('email', email)
        .maybeSingle();
      if (!error && data) profile = data;
    } catch (_) {}
  }

  return profile;
}

function isActiveProfile(profile) {
  if (!profile) return false;
  if (profile.deleted_at) return false;
  if (profile.status && String(profile.status).toLowerCase() === 'deleted') return false;
  if (profile.status && String(profile.status).toLowerCase() === 'inactive') return false;
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
  if (!isActiveProfile(profile)) {
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

async function startGoogleLogin() {
  const btn = $('loginBtn');
  try {
    if (btn) btn.disabled = true;
    setStatus('Відкриваю вхід через Google...');
    const redirectTo = `${window.location.origin}/verify-2fa.html`;
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
  if (!isActiveProfile(profile)) return;
  const aal = await getAal();
  location.href = aal === 'aal2' ? (cfg.AFTER_2FA_URL || 'cabinet.html') : 'verify-2fa.html';
}

window.rebusAuth = {
  supabase: supabaseClient,
  $, setStatus, getSession, fetchProfile, isActiveProfile, requireUser,
  getAal, getAuthenticatorFactors, roleLabel, startGoogleLogin, routeIfAlreadyLoggedIn
};
