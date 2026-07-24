import { supabase } from './supabaseClient.js'
import { getStoredToken } from './auth.js'

// Same window the server uses to decide a session is no longer alive (see
// supabase/schema.sql _session_timeout()). public.presence.last_seen_at is
// only ever pushed forward by a live login/heartbeat/RPC call -- it's never
// proactively cleared when a player goes quiet. So "online" here is a
// client-side judgement made by comparing the last known timestamp against
// the clock, re-evaluated on a timer, rather than a value the server pushes
// on every tick of elapsed time.
export const PRESENCE_TIMEOUT_MS = 45000

const ERROR_MESSAGES = {
  invalid_session: '登录已过期，请重新登录',
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

export function isOnline(lastSeenAt, now = Date.now()) {
  if (!lastSeenAt) return false
  return now - new Date(lastSeenAt).getTime() < PRESENCE_TIMEOUT_MS
}

/* ---------- reads ---------- */
// tournament_participants, accounts, and presence are all publicly
// readable (like accounts already is for the Admin Dashboard) -- fetched
// flat and merged client-side rather than relying on PostgREST's nested
// embedding, to keep this resilient to how the relationships get detected.
export async function fetchLobby() {
  const [participantsRes, accountsRes, presenceRes] = await Promise.all([
    supabase.from('tournament_participants').select('*').order('joined_at', { ascending: true }),
    supabase.from('accounts').select('id, display_name, avatar_url, tournament_role'),
    supabase.from('presence').select('*'),
  ])
  if (participantsRes.error) throw new Error(friendlyError(participantsRes.error, '获取参赛名单失败'))
  if (accountsRes.error) throw new Error(friendlyError(accountsRes.error, '获取用户信息失败'))
  if (presenceRes.error) throw new Error(friendlyError(presenceRes.error, '获取在线状态失败'))

  const accountsById = new Map(accountsRes.data.map((a) => [a.id, a]))
  const presenceById = new Map(presenceRes.data.map((p) => [p.account_id, p]))

  return participantsRes.data
    .map((p) => {
      const account = accountsById.get(p.account_id)
      if (!account) return null // account was deleted; cascade will remove this row shortly
      const presence = presenceById.get(p.account_id)
      return {
        accountId: account.id,
        displayName: account.display_name,
        avatarUrl: account.avatar_url,
        tournamentRole: account.tournament_role,
        joinedAt: p.joined_at,
        lastSeenAt: presence?.last_seen_at ?? null,
      }
    })
    .filter(Boolean)
}

// One channel, three tables -- a join, a leave, a fresh heartbeat, or an
// account edit (display name/avatar) should all refresh the lobby live.
export function subscribeLobby(onChange) {
  const channel = supabase
    .channel('tournament-lobby-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presence' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

/* ---------- writes ---------- */
export async function joinTournament() {
  const { data, error } = await supabase.rpc('join_tournament', { p_token: requireToken() })
  if (error) throw new Error(friendlyError(error, '加入锦标赛失败'))
  return data
}

export async function leaveTournament() {
  const { error } = await supabase.rpc('leave_tournament', { p_token: requireToken() })
  if (error) throw new Error(friendlyError(error, '退出锦标赛失败'))
}
