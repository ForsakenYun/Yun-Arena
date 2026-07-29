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
  insufficient_permission: '权限不足，无法执行该操作',
  roll_range_too_small: '参赛人数超过 100 人，无法在 1–100 范围内摇号',
  invalid_tournament_name: '锦标赛名称不能为空，且不超过 60 个字符',
  invalid_team_count: '队伍数量需在 2–128 之间',
  invalid_players_per_team: '每队人数需在 1–20 之间',
  invalid_draft_order: '选秀顺序格式不正确',
  invalid_draft_order_round_count: '选秀顺序轮数与每队人数不匹配',
  invalid_draft_order_team_count: '每轮的号码数量必须等于队伍数量',
  invalid_draft_order_duplicate_or_missing: '每轮中每支队伍必须且只能出现一次',
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
    supabase.from('accounts').select('id, display_name, avatar_url, tournament_role, gender'),
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
        gender: account.gender,
        joinedAt: p.joined_at,
        lastSeenAt: presence?.last_seen_at ?? null,
        rollNumber: p.roll_number ?? null,
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

// Admin/Developer only -- enforced server-side by _require_role.
export async function removeParticipant(targetAccountId) {
  const { error } = await supabase.rpc('remove_participant', {
    p_token: requireToken(),
    p_target_account_id: targetAccountId,
  })
  if (error) throw new Error(friendlyError(error, '移除参赛者失败'))
}

// Admin/Developer only -- assigns everyone currently joined a unique
// random number (1-100) in one shot, overwriting any previous roll.
export async function rollTournamentNumbers() {
  const { error } = await supabase.rpc('roll_tournament_numbers', { p_token: requireToken() })
  if (error) throw new Error(friendlyError(error, '摇号失败'))
}

// Admin/Developer only -- removes every participant at once, same effect
// as each of them clicking 退出比赛 themselves.
export async function clearTournament() {
  const { error } = await supabase.rpc('clear_tournament', { p_token: requireToken() })
  if (error) throw new Error(friendlyError(error, '清空参赛名单失败'))
}

/* ---------- Tournament Settings (singleton row) ---------- */
// Public read, like the rest of the Lobby's data -- there's only ever one
// row, so this always reflects whatever was saved last. Falls back to
// sensible defaults if the seed row is somehow missing.
export async function fetchTournamentSettings() {
  const { data, error } = await supabase.from('tournament_settings').select('*').maybeSingle()
  if (error) throw new Error(friendlyError(error, '获取锦标赛设置失败'))
  return {
    tournamentName: data?.tournament_name ?? '',
    teamCount: data?.team_count ?? 8,
    playersPerTeam: data?.players_per_team ?? 5,
    // null (not an array) means "never saved yet" -- the dialog generates
    // a fresh default Snake Draft order for the loaded team/player counts
    // in that case, rather than treating an empty draft order as valid.
    draftOrder: Array.isArray(data?.draft_order) ? data.draft_order : null,
  }
}

// Admin/Developer only -- always writes the same singleton row (upsert on
// the fixed id=true key in the database function), so this is "replace the
// one active record", never "create another configuration".
export async function saveTournamentSettings({ tournamentName, teamCount, playersPerTeam, draftOrder }) {
  const { data, error } = await supabase.rpc('save_tournament_settings', {
    p_token: requireToken(),
    p_tournament_name: tournamentName,
    p_team_count: teamCount,
    p_players_per_team: playersPerTeam,
    p_draft_order: draftOrder,
  })
  if (error) throw new Error(friendlyError(error, '保存锦标赛设置失败'))
  return {
    tournamentName: data.tournament_name,
    teamCount: data.team_count,
    playersPerTeam: data.players_per_team,
    draftOrder: data.draft_order,
  }
}

/* ---------- Draft Order Settings ---------- */
// Configuring the order only -- see DEVLOG.md Section 16, Draft Order
// Settings. Captains are assigned manually and never appear in the draft
// order, so there are always exactly playersPerTeam - 1 rounds.
export function draftRoundCount(playersPerTeam) {
  return Math.max(0, (Number(playersPerTeam) || 0) - 1)
}

// Default Snake Draft: odd rounds ascending 1..N, even rounds descending
// N..1, alternating every round.
export function generateSnakeDraft(teamCount, playersPerTeam) {
  const rounds = draftRoundCount(playersPerTeam)
  const ascending = Array.from({ length: Math.max(0, Number(teamCount) || 0) }, (_, i) => i + 1)
  const order = []
  for (let r = 0; r < rounds; r++) {
    order.push(r % 2 === 0 ? [...ascending] : [...ascending].reverse())
  }
  return order
}

// Turns a raw digit stream into a space-separated draft order as the admin
// types, without requiring them to press space themselves. This is a pure
// function of the FULL current digit string: it replays the digits from
// the start through a small state machine (extend the token currently
// being typed, or close it and start a new one) every time it's called,
// which is what makes it work correctly for ordinary forward typing.
//
// The state machine's rule: by default, close the current token as soon as
// it's a valid, not-yet-used team number (this is what makes "12345678"
// become "1 2 3 4 5 6 7 8" for an 8-team tournament, one token per digit).
// It only keeps extending the current token instead when closing it right
// now would be wrong -- either because its value is already used earlier
// in this same round (so it must grow into a different, larger number
// instead, which is what turns "9" then "1" then "0" into "9" then "10"
// for a 12-team tournament) or because the very next digit is '0' (a
// token can never validly start with 0, so it has to belong to the
// previous, still-growing token instead).
//
// Known limitation: a brand-new multi-digit team number typed with no
// internal 0 and no earlier collision (e.g. "23" as the very first
// characters typed in a 30-team tournament) is genuinely ambiguous with no
// further context, and may get split into "2 3". A manual space edit
// afterwards fixes it; Save-time validation always catches the result
// either way.
export function formatDraftRoundInput(raw, teamCount) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  const n = Number(teamCount)
  if (!Number.isInteger(n) || n < 1) return digits

  const locked = []
  let open = ''

  const openValue = () => Number(open)
  const openIsValid = () => open !== '' && openValue() >= 1 && openValue() <= n
  const openIsDuplicate = () => open !== '' && locked.includes(openValue())
  const maxLen = String(n).length

  for (const d of digits) {
    if (!open) {
      open = d
      continue
    }
    const mustExtend = !openIsValid() || openIsDuplicate() || d === '0'
    if (mustExtend && open.length < maxLen) {
      open += d
    } else {
      locked.push(openValue())
      open = d
    }
  }

  const parts = open ? [...locked, openValue()] : locked
  return parts.join(' ')
}

// Parses a round's text into numbers (whitespace-separated, no commas
// needed) for validation and for saving.
export function parseDraftRound(text) {
  return String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
}

// Every team number must appear exactly once, none missing, none
// duplicated, and the count must match teamCount. Checking length ===
// teamCount plus "every value is in range 1..teamCount" plus "no
// duplicates" is sufficient on its own to prove nothing is missing either
// (teamCount distinct values, all in a range of size teamCount, can't
// avoid covering every one of them) -- so no separate "missing" pass is
// needed. Returns an error message in Chinese, or null when the round is
// valid. This mirrors save_tournament_settings' server-side check exactly;
// that check is what actually holds, this one is just so Save can be
// disabled with a clear message before even trying.
export function validateDraftRound(numbers, teamCount) {
  const n = Number(teamCount)
  if (numbers.length !== n) return `需要恰好 ${n} 个号码`
  const seen = new Set()
  for (const value of numbers) {
    if (!Number.isInteger(value) || value < 1 || value > n) {
      return `号码必须是 1–${n} 之间的整数`
    }
    if (seen.has(value)) return `号码 ${value} 重复出现`
    seen.add(value)
  }
  return null
}
