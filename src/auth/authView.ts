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
        <button id="forgot" class="link">Forgot password?</button>
        <div id="err" class="auth-err"></div>
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
  $('forgot').addEventListener('click', () => renderForgot(root, done))
}

function renderForgot(root: HTMLElement, done: () => void) {
  root.innerHTML = `
    <div class="auth"><div class="auth-card">
      <div class="auth-brand">RESET PASSWORD</div>
      <p class="auth-sub">We'll email you a 6-digit code</p>
      <input id="email" type="email" placeholder="Email" />
      <button id="send">Send code</button>
      <div id="step2" hidden>
        <input id="code" inputmode="numeric" placeholder="6-digit code" />
        <input id="newpw" type="password" placeholder="New password" />
        <button id="reset">Set new password</button>
      </div>
      <button id="back" class="link">Back to sign in</button>
      <div id="err" class="auth-err"></div>
    </div></div>`
  const $ = (id: string) => root.querySelector<HTMLInputElement>('#' + id)!
  const err = (m: string) => { root.querySelector<HTMLDivElement>('#err')!.textContent = m }

  $('send').addEventListener('click', async () => {
    err('')
    const { error } = await supabase.auth.resetPasswordForEmail($('email').value.trim())
    if (error) return err(error.message)
    root.querySelector<HTMLDivElement>('#step2')!.hidden = false
  })
  $('reset').addEventListener('click', async () => {
    err('')
    const { error: vErr } = await supabase.auth.verifyOtp({ email: $('email').value.trim(), token: $('code').value.trim(), type: 'recovery' })
    if (vErr) return err(vErr.message)
    const { error: uErr } = await supabase.auth.updateUser({ password: $('newpw').value })
    if (uErr) return err(uErr.message)
    done()
  })
  root.querySelector<HTMLButtonElement>('#back')!.addEventListener('click', () => renderSignIn(root, done))
}
