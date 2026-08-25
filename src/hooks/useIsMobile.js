import { useEffect, useState } from 'react'

// Reactive mobile-breakpoint flag, shared by the chrome that adapts to phones
// (App menu filtering, Inspector compact fields). Matches the CSS breakpoint.
export function useIsMobile(query = '(max-width: 760px)') {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = (e) => setMatch(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return match
}
