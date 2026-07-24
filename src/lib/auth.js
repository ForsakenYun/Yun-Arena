import { supabase } from './supabaseClient.js'

const SESSION_KEY = 'draftstage_session_token'

/* ---------- error translation ---------- */
// Postgres/PostgREST errors come back as { message, code, ... }. We map the
// custom error strings raised in supabase/schema.sql to friendly Chinese
// messages the UI can show directly.
const ERROR_MESSAGES = {
  invalid_username: '用户名格式不正确',
  invalid_password: '密码格式不正确',
  invalid_display_name: '昵称格式不正确',
  invalid_tournament_role: '请选择身份',
  invite_not_found: '邀请码不存在',
  invite_expired: '邀请码已过期',
  invite_exhausted: '邀请码已达到使用上限',
  username_taken: '用户名已被占用',
  invalid_credentials: '用户名或密码错误',
  insufficient_permission: '权限不足',
  invalid_session: '登录已过期，请重新登录',
  user_not_found: '用户不存在',
  cannot_delete_self: '不能删除自己的账号',
  user_not_found_or_not_promotable: '该用户当前无法被提升',
  user_not_found_or_not_demotable: '该用户当前无法被降级',
  invalid_max_uses: '最大使用次数无效',
}

function friendlyError(error, fallback) {
  if (!error) return fallback
  const msg = error.message || ''
  for (const key of Object.keys(ERROR_MESSAGES)) {
    if (msg.includes(key)) return ERROR_MESSAGES[key]
  }
  return fallback || msg || '发生未知错误'
}

/* ---------- session persistence ---------- */
export function getStoredToken() {
  return localStorage.getItem(SESSION_KEY)
}

function storeToken(token) {
  if (token) localStorage.setItem(SESSION_KEY, token)
}

function clearToken() {
  localStorage.removeItem(SESSION_KEY)
}

/* ---------- avatar upload ---------- */
export async function uploadAvatar(file) {
  const ext = file.name.split('.').pop() || 'png'
  const path = `${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('avatars').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw new Error(friendlyError(error, '头像上传失败'))
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl
}

/* ---------- auth actions ---------- */
export async function register({ inviteCode, username, password, displayName, tournamentRole, avatarUrl }) {
  const { data, error } = await supabase.rpc('register_account', {
    p_invite_code: inviteCode,
    p_username: username,
    p_password: password,
    p_display_name: displayName,
    p_tournament_role: tournamentRole,
    p_avatar_url: avatarUrl ?? null,
  })
  if (error) throw new Error(friendlyError(error, '注册失败'))
  storeToken(data.token)
  return data.account
}

export async function login({ username, password }) {
  const { data, error } = await supabase.rpc('login_account', {
    p_username: username,
    p_password: password,
  })
  if (error) throw new Error(friendlyError(error, '登录失败'))
  storeToken(data.token)
  return data.account
}

export async function restoreSession() {
  const token = getStoredToken()
  if (!token) return null
  const { data, error } = await supabase.rpc('validate_session', { p_token: token })
  if (error || !data?.account) {
    clearToken()
    return null
  }
  return data.account
}

export async function logout() {
  const token = getStoredToken()
  clearToken()
  if (token) {
    await supabase.rpc('logout_session', { p_token: token }).catch(() => {})
  }
}

/* ---------- heartbeat / presence ---------- */
// Distinct from the other RPC wrappers on purpose: it does NOT translate
// or swallow errors. A thrown error here means "couldn't reach the
// server" (network drop, etc.) -- the caller (sessionMonitor.js) needs to
// tell that apart from a clean { ok: false } response, which means the
// session itself is genuinely gone and the user should be logged out.
export async function heartbeat(token) {
  const { data, error } = await supabase.rpc('heartbeat', { p_token: token })
  if (error) throw error
  return data
}
