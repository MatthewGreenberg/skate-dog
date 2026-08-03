import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import Game from './game/components/Game.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Game />
    <Analytics />
  </StrictMode>,
)
