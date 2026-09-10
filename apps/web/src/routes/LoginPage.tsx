import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth-context';

export function LoginPage(): JSX.Element {
  const { signIn, mode } = useAuth();
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await signIn(value.trim());
      setStatus(mode === 'invite' ? 'Acesso liberado.' : 'Enviamos o link de acesso para seu e-mail.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel enviar o acesso.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="alpha-auth">
      <section className="alpha-auth-card" aria-labelledby="login-title">
        <div className="dre-rail-logo auth-logo">
          <svg viewBox="0 0 316 226" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M187.422 112.463L282.399 47.835L315.737 96.8271L213.72 166.245H102.017L0 96.8271L33.3369 47.835L128.163 112.359V0H187.422V112.463Z" fill="#FF5500" />
            <rect y="166.245" width="315.585" height="59.2592" fill="#FF5500" />
          </svg>
          <span>ALVOR</span>
        </div>
        <h1 id="login-title">Acesso dos fundadores</h1>
        <p>{mode === 'invite' ? 'Entre com o codigo individual recebido para testar o produto com dados isolados.' : 'Entre com o e-mail convidado para testar o produto com dados isolados.'}</p>
        <form onSubmit={submit}>
          <label>
            {mode === 'invite' ? 'Codigo de convite' : 'E-mail'}
            <input type={mode === 'invite' ? 'text' : 'email'} value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === 'invite' ? 'Cole seu codigo' : 'voce@empresa.com'} required />
          </label>
          <button className="dre-btn" type="submit" disabled={busy}>{busy ? 'Validando...' : mode === 'invite' ? 'Entrar' : 'Receber link de acesso'}</button>
        </form>
        {status !== null && <p className="dre-ok">{status}</p>}
        {error !== null && <p className="dre-err">{error}</p>}
      </section>
    </main>
  );
}
