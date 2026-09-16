import { useEffect, useRef, useState } from 'react'
import AuthPage from './components/AuthPage.jsx'
import AppBackground from './components/AppBackground.jsx'
import AdminDashboard from './components/AdminDashboard.jsx'
import TournamentLobby from './components/TournamentLobby.jsx'
import DraftArena from './components/DraftArena.jsx'
import SpectatorPage from './components/SpectatorPage.jsx'
import DisconnectedModal from './components/DisconnectedModal.jsx'
import { restoreSession, logout as logoutRequest, getStoredToken, updateThemePreference } from './lib/auth.js'
import { subscribeDraftState } from './lib/tournamentApi.js'
import { startSessionMonitor } from './lib/sessionMonitor.js'
import { getStoredTheme, setStoredTheme } from './lib/theme.js'

// Hash-based view switch. `account` (restored from a persisted session
// token, or set right after login) is the single source of truth for who's
// logged in -- Section 8.1's hardcoded Temporary Developer Login is gone.
//
// Session liveness is no longer "trust localStorage until expires_at" --
// while `account` is set, a heartbeat monitor pings the server every few
// seconds (src/lib/sessionMonitor.js). Closing the tab/browser simply
// stops those pings, so the server-side session times out shortly after
// on its own (see supabase/schema.sql _session_timeout()) -- the next
// visit finds no valid session and lands back on the login page. A lost
// connection while the tab stays open surfaces as the disconnect dialog
// below instead of failing silently.
export default function App() {
  const [route, setRoute] = useState(window.location.hash)
  const [account, setAccount] = useState(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState('connected')
  const [loginMessage, setLoginMessage] = useState(null)
  // Theme Switcher -- initialized from localStorage so a reload doesn't
  // flash back to the 'dark' default before restoreSession resolves.
  // Overwritten with the account's own saved value below the moment a
  // session is restored or a login succeeds (DEVLOG: "if a logged-in user
  // has saved 'light' in their profile, load that setting upon login").
  const [theme, setTheme] = useState(() => getStoredTheme())
  const monitorRef = useRef(null)

  // Theme Switcher: the single place this state actually becomes pixels.
  // `[data-theme='light']` in index.css overrides the CSS variables
  // tailwind.config.js's void/panel/panel-alt/panel-2/panel-line/ink.*/
  // accent* tokens point at, so every themed class in the app follows
  // this attribute -- except AuthPage.jsx, which re-locks those same
  // variables back to dark on its own root element (AppShell.jsx's
  // DARK_THEME_LOCK_STYLE) regardless of what this is set to, since it
  // renders before any account/saved theme exists. Draft Arena and the
  // Spectator Page used to do the same (DraftVisualLock), but as of the
  // Theme Switcher's light-mode rollout they follow this attribute like
  // everywhere else (DEVLOG Sections 3/8/9) -- only their brand fonts
  // and neon glow colors stay fixed regardless of theme.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    restoreSession()
      .then((restored) => {
        if (restored) {
          setAccount(restored)
          // Theme Switcher (Step 1): the account row is the source of
          // truth once one exists -- adopt its saved value over whatever
          // localStorage/the 'dark' default guessed before this resolved.
          setTheme(restored.theme)
          setStoredTheme(restored.theme)
          if (restored.permission_role === 'admin' || restored.permission_role === 'developer') {
            window.location.hash = 'admin'
          } else {
            window.location.hash = 'lobby'
          }
        }
      })
      .finally(() => setCheckingSession(false))
  }, [])

  // Heartbeat monitor: runs for the whole project (any logged-in
  // account), not just the Admin Dashboard, per the standing session
  // policy documented in DEVLOG.md Section 6.
  useEffect(() => {
    if (!account) {
      monitorRef.current?.stop()
      monitorRef.current = null
      setConnectionStatus('connected')
      return
    }

    const token = getStoredToken()
    if (!token) return

    monitorRef.current = startSessionMonitor({
      token,
      onStatusChange: setConnectionStatus,
      onExpired: () => {
        logoutRequest().catch(() => {})
        setAccount(null)
        setConnectionStatus('connected')
        window.location.hash = ''
        setLoginMessage('会话已过期，请重新登录')
      },
    })

    return () => monitorRef.current?.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id])

  // Coming back online is a strong signal to retry immediately rather
  // than waiting out the retry interval.
  useEffect(() => {
    function handleOnline() {
      monitorRef.current?.reconnectNow()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  // Auto-redirect non-drafting users to 观赛 the moment a draft starts.
  // tournament_draft_state has no row until the first admin/developer to
  // open the Draft Arena syncs its initial board (see the comment above
  // fetchDraftState/subscribeDraftState in tournamentApi.js) -- so that
  // row's very first INSERT *is* "the draft just started," system-wide,
  // for every connected account. Whoever triggered it already has their
  // own tab on #draft by the time DraftArenaPage's mount effect performs
  // that first sync (TournamentLobby's 开始比赛 sets the hash synchronously,
  // before navigating there), so checking the live hash here -- not
  // touching DraftArenaPage or 开始比赛 at all -- naturally excludes the
  // host/drafter and only redirects everyone else (Lobby, Admin
  // Dashboard, or anyone already spectating a previous draft).
  useEffect(() => {
    if (!account) return
    const unsubscribe = subscribeDraftState((payload) => {
      if (payload.eventType === 'INSERT' && window.location.hash !== '#draft') {
        window.location.hash = 'spectate'
      }
    })
    return unsubscribe
  }, [account?.id])

  function handleLoggedIn(loggedInAccount) {
    setLoginMessage(null)
    setAccount(loggedInAccount)
    // Theme Switcher (Step 1): same adoption as session-restore above --
    // whatever this account last saved wins over the pre-login default.
    setTheme(loggedInAccount.theme)
    setStoredTheme(loggedInAccount.theme)
    if (loggedInAccount.permission_role === 'admin' || loggedInAccount.permission_role === 'developer') {
      window.location.hash = 'admin'
    } else {
      window.location.hash = 'lobby'
    }
  }

  async function handleLogout() {
    await logoutRequest()
    setAccount(null)
    // Theme Switcher (Step 1): logging out returns to the guest default
    // ('dark') rather than leaving the previous account's saved theme
    // showing on a shared browser for whoever logs in next.
    setTheme('dark')
    setStoredTheme('dark')
    window.location.hash = ''
  }

  // Theme Switcher (Step 1): local state + localStorage update
  // immediately and unconditionally (this is what makes the toggle work
  // for a guest too, once one exists) -- for a logged-in account, also
  // persist to Supabase. Best-effort on the DB write, same idiom as
  // heartbeat/logout elsewhere in this file: the UI has already reflected
  // the choice either way, so a failed/offline save just means it isn't
  // remembered next login, not that the toggle itself failed.
  async function handleThemeChange(nextTheme) {
    setTheme(nextTheme)
    setStoredTheme(nextTheme)
    if (!account) return
    try {
      const updated = await updateThemePreference(getStoredToken(), nextTheme)
      setAccount((prev) => (prev ? { ...prev, theme: updated.theme } : prev))
    } catch {
      // Best-effort persistence -- see comment above.
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen w-full bg-void">
        <AppBackground />
      </div>
    )
  }

  const isStaff = account && (account.permission_role === 'admin' || account.permission_role === 'developer')
  const isDashboard = route === '#admin' && isStaff
  // Phase 5 -- Draft System Top Bar. Reached only via the Tournament
  // Lobby's "开始比赛" button for now (Section 2's placeholder is gone;
  // see DEVLOG.md Roadmap). Not yet gated to staff-only, same as the rest
  // of the (still very early) Draft System scope.
  const isDraft = route === '#draft' && !!account
  // Phase 6 -- Spectator Page. Read-only, reachable by any logged-in
  // account (normal users included) via the Tournament Lobby's 观赛
  // button; never a default landing route on login/session-restore.
  const isSpectate = route === '#spectate' && !!account

  let view
  if (isDashboard) {
    view = (
      <AdminDashboard
        account={account}
        onLogout={handleLogout}
        onOpenLobby={() => (window.location.hash = 'lobby')}
        theme={theme}
        onThemeChange={handleThemeChange}
      />
    )
  } else if (isDraft) {
    view = (
      <DraftArena
        onExitToLobby={() => (window.location.hash = 'lobby')}
        account={account}
        onLogout={handleLogout}
        theme={theme}
        onThemeChange={handleThemeChange}
      />
    )
  } else if (isSpectate) {
    view = (
      <SpectatorPage
        onExitToLobby={() => (window.location.hash = 'lobby')}
        account={account}
        onLogout={handleLogout}
        theme={theme}
        onThemeChange={handleThemeChange}
      />
    )
  } else if (account) {
    // Default logged-in destination for everyone (Section: navigation).
    // Admin/Developer accounts can reach this from the dashboard's
    // Tournament Lobby button and jump back with the button rendered here.
    view = (
      <TournamentLobby
        account={account}
        onLogout={handleLogout}
        onOpenAdmin={isStaff ? () => (window.location.hash = 'admin') : undefined}
        theme={theme}
        onThemeChange={handleThemeChange}
      />
    )
  } else {
    view = <AuthPage onLoggedIn={handleLoggedIn} initialMessage={loginMessage} />
  }

  return (
    <>
      {view}

      {account && connectionStatus === 'disconnected' && (
        <DisconnectedModal onReconnect={() => monitorRef.current?.reconnectNow()} />
      )}
    </>
  )
}
