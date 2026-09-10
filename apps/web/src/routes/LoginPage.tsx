import { useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth-context';
import { ApiError } from '../lib/api-client';
import './LoginPage.css';

function AccessIcon({ kind }: { readonly kind: 'arrow' | 'check' | 'error' | 'invite' }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {kind === 'arrow' && <path d="M4 12h15m-6-6 6 6-6 6" />}
      {kind === 'check' && <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>}
      {kind === 'error' && <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5m0 3h.01" /></>}
      {kind === 'invite' && <><path d="M14 5H4v14h16V9M4 9l8 5 4-2.5M19 2v6m-3-3h6" /></>}
    </svg>
  );
}

export function LoginPage(): JSX.Element {
  const { signIn, mode } = useAuth();
  const isInvite = mode === 'invite';
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    setStatus(null);

    const input = inputRef.current;
    const trimmedValue = value.trim();
    if (trimmedValue.length === 0 || (input !== null && !input.validity.valid)) {
      setError(isInvite ? 'Digite ou cole o código do seu convite.' : 'Informe um e-mail válido para receber o link de acesso.');
      input?.focus();
      return;
    }
    if (isInvite && trimmedValue.length < 8) {
      setError('Confira seu convite e cole o código completo.');
      input?.focus();
      return;
    }

    submitting.current = true;
    setBusy(true);
    try {
      await signIn(trimmedValue);
      setStatus(isInvite ? 'Convite confirmado. Entrando no ALVOR…' : 'Link enviado. Confira sua caixa de entrada e, se necessário, a pasta de spam.');
    } catch (err) {
      setError(isInvite && err instanceof ApiError && err.status === 401
        ? 'Código não reconhecido. Confira seu convite e tente novamente.'
        : err instanceof Error && err.message.trim().length > 0 ? err.message : 'Não foi possível entrar. Tente novamente em instantes.');
      inputRef.current?.focus();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="alvor-access" lang="pt-BR">
      <header className="alvor-access__brand">
        <div className="alvor-access__lockup">
          <svg viewBox="0 0 316 226" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <path d="M187.422 112.463L282.399 47.835L315.737 96.8271L213.72 166.245H102.017L0 96.8271L33.3369 47.835L128.163 112.359V0H187.422V112.463Z" fill="#FF5500" />
            <rect y="166.245" width="315.585" height="59.2592" fill="#FF5500" />
          </svg>
          <span>ALVOR</span>
        </div>
        <span className="alvor-access__edition">Um novo olhar financeiro</span>
      </header>

      <section className="alvor-access__entry" aria-labelledby="alvor-access-title">
        <div className="alvor-access__entry-heading">
          <AccessIcon kind="invite" />
          <span>Acesso por convite</span>
        </div>

        <div className="alvor-access__entry-body">
          <p className="alvor-access__eyebrow">Seu próximo passo</p>
          <h1 id="alvor-access-title" className="alvor-access__title">O convite é seu.<br />Entre e explore.</h1>
          <p className="alvor-access__intro">
            {isInvite ? 'Use seu código pessoal para começar a testar o ALVOR.' : 'Use o e-mail do seu convite para receber um link de acesso ao ALVOR.'}
          </p>

          <form className="alvor-access__form" onSubmit={submit} noValidate aria-busy={busy}>
            <label className="alvor-access__label" htmlFor="alvor-access-value">
              {isInvite ? 'Código de convite' : 'E-mail do convite'}
            </label>
            <input
              ref={inputRef}
              className="alvor-access__input"
              id="alvor-access-value"
              name={isInvite ? 'invite-code' : 'email'}
              type={isInvite ? 'text' : 'email'}
              inputMode={isInvite ? 'text' : 'email'}
              autoComplete={isInvite ? 'off' : 'email'}
              autoCapitalize="none"
              spellCheck={false}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
                setStatus(null);
              }}
              placeholder={isInvite ? 'Cole seu código aqui' : 'voce@empresa.com'}
              readOnly={busy}
              required
              aria-invalid={error !== null}
              aria-describedby={`alvor-access-hint${error !== null ? ' alvor-access-error' : ''}${status !== null ? ' alvor-access-status' : ''}`}
            />
            <p className="alvor-access__hint" id="alvor-access-hint">
              {isInvite ? 'Use o código completo que você recebeu no convite.' : 'Enviaremos um link para você entrar, sem senha.'}
            </p>

            <div id="alvor-access-error" className="alvor-access__feedback alvor-access__feedback--error" role="alert" aria-atomic="true">
              {error !== null && <><AccessIcon kind="error" /><p>{error}</p></>}
            </div>

            <button className="alvor-access__submit" type="submit" disabled={busy}>
              <span>{busy ? (isInvite ? 'Validando convite…' : 'Enviando link…') : (isInvite ? 'Entrar no ALVOR' : 'Receber link de acesso')}</span>
              {busy ? <span className="alvor-access__spinner" aria-hidden="true" /> : <AccessIcon kind="arrow" />}
            </button>

            <div id="alvor-access-status" className="alvor-access__feedback alvor-access__feedback--status" role="status" aria-atomic="true">
              {busy ? <p>{isInvite ? 'Conferindo seu convite. Aguarde um instante.' : 'Enviando seu link de acesso. Aguarde um instante.'}</p> : status !== null && <><AccessIcon kind="check" /><p>{status}</p></>}
            </div>
          </form>

          <aside className="alvor-access__help" aria-label="Ajuda com o convite">
            <p className="alvor-access__help-title">Seu convite, seu ponto de partida.</p>
            <p>{isInvite ? 'Não encontrou o código? Fale com quem convidou você para testar o ALVOR.' : 'Não recebeu o link? Confira o e-mail informado ou fale com quem convidou você.'}</p>
          </aside>
        </div>

        <p className="alvor-access__entry-footer">Entre. Experimente. Compartilhe seu olhar.</p>
      </section>

      <section className="alvor-access__story" aria-labelledby="alvor-access-story-title">
        <p className="alvor-access__eyebrow">Finanças com perspectiva</p>
        <h2 id="alvor-access-story-title" className="alvor-access__statement">
          Dos números<br />às <span>decisões.</span>
        </h2>
        <p className="alvor-access__story-copy">Um convite para olhar de perto o resultado do seu negócio. Explore, faça perguntas e ajude a construir o próximo passo do ALVOR.</p>
        <div className="alvor-access__reading" aria-label="O que explorar no ALVOR">
          <span>Seu resultado</span>
          <AccessIcon kind="arrow" />
          <span>Suas perguntas</span>
          <AccessIcon kind="arrow" />
          <span>Próximos passos</span>
        </div>
      </section>

      <footer className="alvor-access__note">
        <span className="alvor-access__note-mark" aria-hidden="true" />
        <p>O ALVOR começa com uma nova leitura.<br /><span>A sua experiência ajuda a ir além.</span></p>
      </footer>
    </main>
  );
}
