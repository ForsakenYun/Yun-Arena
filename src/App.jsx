import { useEffect, useState } from 'react'
import AuthPage from './components/AuthPage.jsx'
import AdminDashboard from './components/AdminDashboard.jsx'
import { restoreSession, logout as logoutRequest } from './lib/auth.js'

// Hash-based view switch. `account` (restored from a persisted session
// token, or set right after login) is the single source of truth for who's
// logged in -- Section 8.1's hardcoded Temporary Developer Login is gone.
export default function App() {
  const [route, setRoute] = useState(window.location.hash)
  const [account, setAccount] = useState(null)
  const [checkingSession, setCheckingSession] = useState(true)

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

  function handleLoggedIn(loggedInAccount) {
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

  if (route === '#admin' && account && (account.permission_role === 'admin' || account.permission_role === 'developer')) {
    return <AdminDashboard account={account} onLogout={handleLogout} />
  }

  return <AuthPage onLoggedIn={handleLoggedIn} />
}
