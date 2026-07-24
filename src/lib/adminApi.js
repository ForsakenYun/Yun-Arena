import { supabase } from './supabaseClient.js'
import { getStoredToken } from './auth.js'

const ERROR_MESSAGES = {
  invalid_username: '用户名格式不正确',
  invalid_display_name: '昵称格式不正确',
  invalid_tournament_role: '身份无效',
  username_taken: '用户名已被占用',
  insufficient_permission: '权限不足，仅开发者可执行该操作',
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

function requireToken() {
  const token = getStoredToken()
  if (!token) throw new Error('登录已过期，请重新登录')
  return token
}

/* ---------- users ---------- */
// The `accounts` table is publicly readable and realtime-enabled, so the
// dashboard can query/subscribe to it directly with the anon key. Writes
// still go through permission-checked RPC functions below.
export async function fetchUsers() {
  const { data, error } = await supabase.from('accounts').select('*').order('created_at', { ascending: true })
  if (error) throw new Error(friendlyError(error, '获取用户列表失败'))
  return data
}

export function subscribeUsers(onChange) {
  const channel = supabase
    .channel('accounts-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

export async function editUser({ id, username, displayName, password, tournamentRole }) {
  const { data, error } = await supabase.rpc('edit_user', {
    p_token: requireToken(),
    p_target_id: id,
    p_username: username,
    p_display_name: displayName,
    p_password: password || null,
    p_tournament_role: tournamentRole,
  })
  if (error) throw new Error(friendlyError(error, '更新用户失败'))
  return data
}

export async function deleteUser(id) {
  const { error } = await supabase.rpc('delete_user', { p_token: requireToken(), p_target_id: id })
  if (error) throw new Error(friendlyError(error, '删除用户失败'))
}

export async function promoteUser(id) {
  const { data, error } = await supabase.rpc('promote_user', { p_token: requireToken(), p_target_id: id })
  if (error) throw new Error(friendlyError(error, '提升用户失败'))
  return data
}

export async function demoteUser(id) {
  const { data, error } = await supabase.rpc('demote_user', { p_token: requireToken(), p_target_id: id })
  if (error) throw new Error(friendlyError(error, '降级用户失败'))
  return data
}

/* ---------- invite codes ---------- */
// invite_codes has no public RLS policy at all, so it can only be read via
// this permission-checked RPC — never via a direct .from('invite_codes').
export async function fetchInviteCodes() {
  const { data, error } = await supabase.rpc('list_invite_codes', { p_token: requireToken() })
  if (error) throw new Error(friendlyError(error, '获取邀请码失败'))
  return data
}

export async function createInviteCode({ maxUses, expiresAt }) {
  const { data, error } = await supabase.rpc('create_invite_code', {
    p_token: requireToken(),
    p_max_uses: maxUses,
    p_expires_at: expiresAt,
  })
  if (error) throw new Error(friendlyError(error, '生成邀请码失败'))
  return data
}

export async function deleteInviteCode(id) {
  const { error } = await supabase.rpc('delete_invite_code', { p_token: requireToken(), p_id: id })
  if (error) throw new Error(friendlyError(error, '删除邀请码失败'))
}

// Invite codes themselves are never sent over realtime. Instead we listen
// for a lightweight "something about invites changed" signal on the public
// sync_events table and re-fetch the (permission-checked) list via RPC.
export function subscribeInviteEvents(onEvent) {
  const channel = supabase
    .channel('sync-events-realtime')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'sync_events', filter: 'scope=eq.invites' },
      onEvent
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}
