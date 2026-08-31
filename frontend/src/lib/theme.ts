import { useCallback, useEffect, useState } from 'react'

export type ColorTheme = 'light' | 'dark'

const STORAGE_KEY = 'leepr-theme'
const THEME_EVENT = 'leepr-theme-change'

function savedTheme(): ColorTheme | null {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved === 'light' || saved === 'dark' ? saved : null
}

export function currentTheme(): ColorTheme {
  return savedTheme() ?? 'light'
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
    const onThemeChange = () => setTheme(currentTheme())
    window.addEventListener(THEME_EVENT, onThemeChange)
    return () => window.removeEventListener(THEME_EVENT, onThemeChange)
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
