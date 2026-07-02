import { supabase } from '../supabase'

/** Show the sign-in UI; resolves once the user has a valid session. */
export async function requireSession(root: HTMLElement): Promise<void> {
  const { data } = await supabase.auth.getSession()
  if (data.session) return
  return new Promise<void>((resolve) => renderSignIn(root, resolve))
}

function renderSignIn(root: HTMLElement, done: () => void) {
  root.innerHTML = `
    <div class="auth">
      <div class="auth-card">
        <div class="auth-brand">CREWLU<span>·</span>FLIGHT GLOBE</div>
        <p class="auth-sub">Sign in with your Crewlu account</p>
        <input id="email" type="email" placeholder="Email" autocomplete="email" />
        <input id="password" type="password" placeholder="Password" autocomplete="current-password" />
        <button id="signin">Sign in</button>
        <div id="err" class="auth-err"></div>
        <a class="link" href="?demo=1" style="display:block;margin-top:14px;font-size:11px;letter-spacing:1px">VIEW A DEMO GLOBE →</a>
      </div>
    </div>`
  const $ = (id: string) => root.querySelector<HTMLInputElement>('#' + id)!
  const err = (m: string) => { root.querySelector<HTMLDivElement>('#err')!.textContent = m }

  $('signin').addEventListener('click', async () => {
    err('')
    const { error } = await supabase.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value })
    if (error) return err(error.message)
    done()
  })
}
