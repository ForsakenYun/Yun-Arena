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
  invalid_temp_participant_count: '临时测试用户数量无效',
  no_final_matchups: '尚未生成最终对阵，请先进入最终对阵阶段',
  invalid_final_matchup_teams: '战队数据无效，无法生成最终对阵',
  invalid_match_index: '对阵编号无效',
  invalid_team_index: '战队编号无效',
  duplicate_team_selection: '请选择两支不同的战队',
  team_already_matched: '该战队已在其他对阵中，请先解除原有配对',
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

/* ---------- Temporary Testing Buttons (Phase 5) ---------- */
// Admin/Developer only. Creates real accounts (with real credentials) --
// captainCount with tournament_role='captain', playerCount with
// tournament_role='player', gender mixed -- and auto-joins every one of
// them to the tournament in one call. They flow through the exact same
// fetchLobby()/Realtime path as any other participant; is_temp is only
// ever inspected server-side by removeTempParticipants().
export async function createTempParticipants(captainCount, playerCount) {
  const { error } = await supabase.rpc('create_temp_participants', {
    p_token: requireToken(),
    p_captain_count: captainCount,
    p_player_count: playerCount,
  })
  if (error) throw new Error(friendlyError(error, '创建临时测试用户失败'))
}

// Admin/Developer only -- deletes every account ever created by
// createTempParticipants() (and, via cascade, their credentials/
// tournament_participants/presence rows). Never touches a real account.
export async function removeTempParticipants() {
  const { error } = await supabase.rpc('remove_temp_participants', { p_token: requireToken() })
  if (error) throw new Error(friendlyError(error, '移除临时测试用户失败'))
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
// Configuring the order only -- see DEVLOG.md Section 7, Draft Order
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

/* ---------- Final Matchups (Draft Arena, Phase 5 -- 对阵生成) ---------- */
// The only server-persisted snapshot of a completed draft's teams --
// captain identity only (id/name/avatar), never full rosters, since only
// captain-vs-captain matchups are ever shown on this stage. Its presence
// is itself the signal that every connected Draft Arena client uses (via
// Realtime) to switch into the Final Matchups stage; its absence means no
// tournament has reached this stage yet, or End Tournament just cleared it.
function normalizeMatchesRow(row) {
  if (!row) return null
  return {
    teams: Array.isArray(row.teams) ? row.teams : [],
    matchups: Array.isArray(row.matchups) ? row.matchups : [],
    updatedAt: row.updated_at ?? null,
  }
}

export async function fetchFinalMatchups() {
  const { data, error } = await supabase.from('tournament_matches').select('*').maybeSingle()
  if (error) throw new Error(friendlyError(error, '获取最终对阵失败'))
  return normalizeMatchesRow(data)
}

// One row, one channel -- every INSERT/UPDATE means "render this stage
// with this data", every DELETE means "End Tournament happened, leave
// this stage" (see DraftArena.jsx's subscription for how DELETE is
// handled, since payload.new is empty on delete and the caller needs the
// raw event, not just the normalized row).
export function subscribeFinalMatchups(onChange) {
  const channel = supabase
    .channel('tournament-matches-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_matches' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// Admin/Developer only. Snapshots the given teams (see toFinalMatchupTeam
// below for the exact shape) and starts with a completely blank matchups
// array -- nothing is auto-generated. Called once, when 进入最终对阵 is
// clicked.
export async function enterFinalMatchups(teams) {
  const { data, error } = await supabase.rpc('enter_final_matchups', {
    p_token: requireToken(),
    p_teams: teams,
  })
  if (error) throw new Error(friendlyError(error, '生成最终对阵失败'))
  return normalizeMatchesRow(data)
}

// Admin/Developer only. Manual Pairing: hand-picks two teams and locks
// them together in one step (a manually created matchup is always born
// locked). Either team already appearing in any existing matchup is
// rejected server-side.
export async function createManualMatchup(teamAIdx, teamBIdx) {
  const { data, error } = await supabase.rpc('create_manual_matchup', {
    p_token: requireToken(),
    p_team_a: teamAIdx,
    p_team_b: teamBIdx,
  })
  if (error) throw new Error(friendlyError(error, '创建对阵失败'))
  return normalizeMatchesRow(data)
}

// Admin/Developer only. Dissolves one matchup entirely -- both teams
// return to the "remaining teams" pool immediately.
export async function removeTournamentMatchup(matchIndex) {
  const { data, error } = await supabase.rpc('remove_tournament_matchup', {
    p_token: requireToken(),
    p_match_index: matchIndex,
  })
  if (error) throw new Error(friendlyError(error, '解除对阵失败'))
  return normalizeMatchesRow(data)
}

// Admin/Developer only. Randomizes only teams not yet in ANY existing
// matchup (locked or unlocked); locked matchups are left completely
// untouched.
export async function rollTournamentMatchups() {
  const { data, error } = await supabase.rpc('roll_tournament_matchups', { p_token: requireToken() })
  if (error) throw new Error(friendlyError(error, '随机排位失败'))
  return normalizeMatchesRow(data)
}

// Admin/Developer only. Random Roll. Pass an array of team idxs to scope
// the roll to exactly that pool (any size, no 2-team cap) -- only those
// teams are shuffled and paired (odd pool size means one bye:
// {a, b:null}). Pass null/undefined/[] (or call with no argument) to
// roll every currently-free team instead -- the default computed
// server-side, not guessed on the client, so this is safe to call the
// instant Final Matchups opens with nothing selected. Either way, every
// existing matchup (locked or unlocked) and every free team outside
// whatever pool ends up being rolled is left completely untouched. New
// pairs are appended after whatever's already in the matchups array.
export async function rollTournamentMatchupsPool(teamIdxs = null) {
  const pool = Array.isArray(teamIdxs) && teamIdxs.length > 0 ? teamIdxs : null
  const { data, error } = await supabase.rpc('roll_tournament_matchups_pool', {
    p_token: requireToken(),
    p_team_idxs: pool,
  })
  if (error) throw new Error(friendlyError(error, '随机排位失败'))
  return normalizeMatchesRow(data)
}

// Admin/Developer only. Toggles a single match slot's lock flag by its
// position in the matchups array.
export async function lockTournamentMatchup(matchIndex, locked) {
  const { data, error } = await supabase.rpc('lock_tournament_matchup', {
    p_token: requireToken(),
    p_match_index: matchIndex,
    p_locked: locked,
  })
  if (error) throw new Error(friendlyError(error, '锁定对阵失败'))
  return normalizeMatchesRow(data)
}

// Admin/Developer only. Restores a completely blank matchups array -- no
// generated matchups, no locks, no manual pairings -- exactly the state
// right after 进入最终对阵.
export async function resetTournamentMatchups() {
  const { data, error } = await supabase.rpc('reset_tournament_matchups', { p_token: requireToken() })
  if (error) throw new Error(friendlyError(error, '重置对阵失败'))
  return normalizeMatchesRow(data)
}

// Admin/Developer only. Ends the tournament outright: clears the Final
// Matchups snapshot and every joined participant (same effect as
// clear_tournament, batched into the same call) -- nobody carries over
// into the next tournament, and every connected client (drafting or
// already on the Final Matchups stage) is sent back to the Tournament
// Lobby by the resulting Realtime DELETE event.
export async function endTournament() {
  const { error } = await supabase.rpc('end_tournament', { p_token: requireToken() })
  if (error) throw new Error(friendlyError(error, '结束锦标赛失败'))
}

/* ---------- Live Draft State (Phase 6 -- Spectator Page) ---------- */
// A one-way broadcast mirror of the Draft Arena's local `tournament`
// state (captain-assignment/teammate-draft phases), written only by
// whichever admin/developer is actually driving the draft, purely so the
// read-only Spectator Page can render it live via Realtime -- never read
// back by the Draft Arena itself. Absence of a row means no draft is
// currently in progress (it hasn't started yet, already reached Final
// Matchups, or the admin running it already left/ended the tournament).
function normalizeDraftStateRow(row) {
  if (!row || !row.state || typeof row.state !== 'object') return null
  return { ...row.state, updatedAt: row.updated_at ?? null }
}

export async function fetchDraftState() {
  const { data, error } = await supabase.from('tournament_draft_state').select('*').maybeSingle()
  if (error) throw new Error(friendlyError(error, '获取选秀状态失败'))
  return normalizeDraftStateRow(data)
}

export function subscribeDraftState(onChange) {
  const channel = supabase
    .channel('tournament-draft-state-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_draft_state' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// Admin/Developer only. Fire-and-forget -- called by DraftArenaPage every
// time its local `tournament` state actually changes, so this must never
// be awaited for correctness by the Draft Arena itself; a failed/late
// write here can never block or alter the admin's own drafting
// experience. Rejected server-side for any non-staff caller, same as
// every other admin-only RPC.
export async function syncDraftState(state) {
  const { data, error } = await supabase.rpc('sync_draft_state', {
    p_token: requireToken(),
    p_state: state,
  })
  if (error) throw new Error(friendlyError(error, '同步选秀状态失败'))
  return normalizeDraftStateRow(data)
}

// Admin/Developer only -- clears the broadcast draft state, e.g. when the
// admin leaves the Draft Arena before finishing, so the Spectator Page
// doesn't keep mirroring a draft nobody is running anymore.
export async function clearDraftState() {
  const { error } = await supabase.rpc('clear_draft_state', { p_token: requireToken() })
  if (error) throw new Error(friendlyError(error, '清除选秀状态失败'))
}

// Builds the exact captain-only shape enterFinalMatchups() persists, from
// a drafted `teams` array (DraftArena's local tournament.teams -- each
// {captain: {id,name,avatarUrl}, slots: [...]}). idx is each team's
// position in that array, which is what matchups[].a/b refer back to.
export function toFinalMatchupTeam(team, idx) {
  return {
    idx,
    captainAccountId: team.captain?.id ?? null,
    captainName: team.captain?.name ?? '',
    captainAvatarUrl: team.captain?.avatarUrl ?? null,
  }
}
