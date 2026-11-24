import { createRoot } from 'react-dom/client'
import 'ui-sdk-elements/theme.css'
import { App } from './app.tsx'
import './style.css'

createRoot(document.getElementById('root')!).render(<App />)
