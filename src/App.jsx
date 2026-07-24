import { useEffect, useRef, useState } from 'react'
import AuthPage from './components/AuthPage.jsx'
import AdminDashboard from './components/AdminDashboard.jsx'
import DisconnectedModal from './components/DisconnectedModal.jsx'
import { restoreSession, logout as logoutRequest, getStoredToken } from './lib/auth.js'
import { startSessionMonitor } from './lib/sessionMonitor.js'

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
  const monitorRef = useRef(null)

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
          if (restored.permission_role === 'admin' || restored.permission_role === 'developer') {
            window.location.hash = 'admin'
          }
        }
      })
      .finally(() => setCheckingSession(false))
  }, [])

  // Heartbeat monitor: runs for the whole project (any logged-in
  // account), not just the Admin Dashboard, per the standing session
  // policy documented in DEVLOG.md Section 15.
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

  function handleLoggedIn(loggedInAccount) {
    setLoginMessage(null)
    setAccount(loggedInAccount)
    if (loggedInAccount.permission_role === 'admin' || loggedInAccount.permission_role === 'developer') {
      window.location.hash = 'admin'
    }
  }

  async function handleLogout() {
    await logoutRequest()
    setAccount(null)
    window.location.hash = ''
  }

  if (checkingSession) {
    return <div className="min-h-screen w-full bg-void" />
  }

  const isDashboard =
    route === '#admin' && account && (account.permission_role === 'admin' || account.permission_role === 'developer')

  return (
    <>
      {isDashboard ? (
        <AdminDashboard account={account} onLogout={handleLogout} />
      ) : (
        <AuthPage onLoggedIn={handleLoggedIn} initialMessage={loginMessage} />
      )}

      {account && connectionStatus === 'disconnected' && (
        <DisconnectedModal onReconnect={() => monitorRef.current?.reconnectNow()} />
      )}
    </>
  )
}
