// Theme Switcher (Step 1) -- local-storage mirror of the current dark/light
// choice, same idiom as SESSION_KEY in auth.js. This is what lets the app
// default to 'dark' for guests/new logins (nothing in localStorage yet, or
// a value that isn't 'light' falls back to 'dark') and keeps the choice
// available across reloads even before a session is restored. For a
// logged-in account, App.jsx overwrites this with `account.theme` once the
// session/login response comes back -- see the DB is the source of truth
// there, this is just the fast local echo of it.
const THEME_KEY = 'draftstage_theme'

export function getStoredTheme() {
  const value = localStorage.getItem(THEME_KEY)
  return value === 'light' ? 'light' : 'dark'
}

export function setStoredTheme(theme) {
  localStorage.setItem(THEME_KEY, theme === 'light' ? 'light' : 'dark')
}
