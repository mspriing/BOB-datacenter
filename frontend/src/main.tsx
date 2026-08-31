import { createRoot } from 'react-dom/client'
import App from './App'
import './lib/maplibreWorker'
import './styles.css'
import { initializeTheme } from './lib/theme'

// Backstop: if any scroll reveal fails to fire, force everything visible.
setTimeout(() => document.documentElement.classList.add('force-visible'), 2500)

initializeTheme()

createRoot(document.getElementById('root')!).render(<App />)
