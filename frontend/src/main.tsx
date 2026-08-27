import { createRoot } from 'react-dom/client'
import App from './App'
import './lib/maplibreWorker'
import './styles.css'

// Backstop: if any scroll reveal fails to fire, force everything visible.
setTimeout(() => document.documentElement.classList.add('force-visible'), 2500)

createRoot(document.getElementById('root')!).render(<App />)
