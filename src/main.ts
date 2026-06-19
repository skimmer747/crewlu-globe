import './styles.css'
import { requireSession } from './auth/authView'
const app = document.querySelector<HTMLDivElement>('#app')!
await requireSession(app)
app.textContent = 'Signed in ✓ (globe goes here)'
