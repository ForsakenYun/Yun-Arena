import { heartbeat } from './auth.js'

// How often to ping the server while the connection looks healthy.
// Comfortably inside the server's _session_timeout() (45s, see
// supabase/schema.sql) so a normal, connected tab never times out.
const HEARTBEAT_INTERVAL_MS = 15000

// How often to retry while we believe we're disconnected. Faster than
// the normal interval so a brief network blip reconnects quickly.
const RECONNECT_INTERVAL_MS = 3000

/**
 * Starts a heartbeat loop for the given session token.
 *
 * onStatusChange('connected' | 'disconnected') fires whenever the
 * connection state actually changes -- this is what drives the
 * "网络连接已断开" dialog.
 *
 * onExpired() fires exactly once, when the server confirms the session
 * itself is gone (heartbeat timeout elapsed, or it was invalidated some
 * other way) -- as opposed to a network error, which just keeps retrying
 * instead of logging the user out.
 *
 * Returns { stop, reconnectNow }.
 */
export function startSessionMonitor({ token, onStatusChange, onExpired }) {
  let stopped = false
  let timer = null
  let status = 'connected'

  function setStatus(next) {
    if (status !== next) {
      status = next
      onStatusChange(next)
    }
  }

  function schedule(delay) {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(tick, delay)
  }

  async function tick() {
    if (stopped) return
    try {
      const result = await heartbeat(token)
      if (stopped) return
      if (result?.ok) {
        setStatus('connected')
        schedule(HEARTBEAT_INTERVAL_MS)
      } else {
        // Not a connectivity problem -- the server has confirmed this
        // session is genuinely no longer valid. Retrying won't help.
        stopped = true
        clearTimeout(timer)
        onExpired()
      }
    } catch {
      // Couldn't even reach the server: treat as disconnected and keep
      // retrying in the background until either connectivity returns
      // (onStatusChange('connected') fires and everything resumes
      // silently) or the session times out server-side, which the next
      // successful-but-{ok:false} heartbeat will report as onExpired().
      if (stopped) return
      setStatus('disconnected')
      schedule(RECONNECT_INTERVAL_MS)
    }
  }

  function stop() {
    stopped = true
    clearTimeout(timer)
  }

  // Lets the "重新连接" button (and coming back online) trigger an
  // immediate attempt instead of waiting out the retry interval.
  function reconnectNow() {
    if (stopped) return
    clearTimeout(timer)
    tick()
  }

  tick()

  return { stop, reconnectNow }
}
