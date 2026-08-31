import { useCallback, useEffect, useState } from 'react'

export type ColorTheme = 'light' | 'dark'

const STORAGE_KEY = 'leepr-theme'
const THEME_EVENT = 'leepr-theme-change'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function savedTheme(): ColorTheme | null {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved === 'light' || saved === 'dark' ? saved : null
}

function systemTheme(): ColorTheme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export function currentTheme(): ColorTheme {
  return savedTheme() ?? systemTheme()
}

function applyTheme(theme: ColorTheme): void {
  document.documentElement.dataset.theme = theme
}

export function initializeTheme(): void {
  applyTheme(currentTheme())
}

export function useTheme(): { theme: ColorTheme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<ColorTheme>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY)
    const onSystemChange = () => {
      if (savedTheme()) return
      const next = systemTheme()
      applyTheme(next)
      setTheme(next)
    }
    const onThemeChange = () => setTheme(currentTheme())
    media.addEventListener('change', onSystemChange)
    window.addEventListener(THEME_EVENT, onThemeChange)
    return () => {
      media.removeEventListener('change', onSystemChange)
      window.removeEventListener(THEME_EVENT, onThemeChange)
    }
  }, [])

  const toggleTheme = useCallback(() => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark'
    localStorage.setItem(STORAGE_KEY, next)
    applyTheme(next)
    setTheme(next)
    window.dispatchEvent(new Event(THEME_EVENT))
  }, [])

  return { theme, toggleTheme }
}

export function cssColor(name: `--${string}`): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
