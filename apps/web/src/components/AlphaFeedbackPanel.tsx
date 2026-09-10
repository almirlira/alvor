import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { apiClient } from '../lib/api-client';
import { useDre } from '../lib/dre-context';
import {
  alphaScriptVersion,
  alphaTasks,
  areaForPath,
  areaLabels,
  taskForArea,
  taskStatusLabels,
  type AlphaFeedbackDetails,
  type AlphaTaskId,
  type AlphaTaskStatus,
  type FeedbackRatings,
} from '../lib/alpha-research';

interface Draft {
  readonly id: string;
  readonly area: string;
  readonly ease: string;
  readonly outcome: '' | AlphaTaskStatus;
  readonly comment: string;
  readonly details: AlphaFeedbackDetails;
}

const draftKey = 'alvor-alpha-feedback-draft-v1';
const progressKey = 'alvor-alpha-progress-v1';

function emptyDraft(area = 'geral', taskId?: AlphaTaskId, loadedDre = false, path = '/'): Draft {
  return {
    id: crypto.randomUUID(),
    area,
    ease: '',
    outcome: '',
    comment: '',
    details: { taskId, context: { area, path, loadedDre } },
  };
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function hasDraft(draft: Draft): boolean {
  return Boolean(draft.comment.trim() || draft.ease || draft.outcome || Object.keys(draft.details.ratings ?? {}).length > 0);
}

function FeedbackIcon({ kind }: { readonly kind: 'review' | 'close' | 'check' }): JSX.Element {
  const common = { vectorEffect: 'non-scaling-stroke' as const };
  const paths = {
    review: (
      <>
        <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v8A2.5 2.5 0 0 1 16.5 16H11l-4 3v-3.1A2.5 2.5 0 0 1 5 13.5v-8Z" {...common} />
        <path d="M9 8h6" {...common} />
        <path d="M9 11h4" {...common} />
      </>
    ),
    close: (
      <>
        <path d="M7 7l10 10" {...common} />
        <path d="M17 7 7 17" {...common} />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="8" {...common} />
        <path d="m8.5 12.5 2.2 2.2 4.8-5.2" {...common} />
      </>
    ),
  };

  return (
    <svg className="alpha-feedback-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[kind]}
    </svg>
  );
}

export function AlphaFeedbackPanel(): JSX.Element {
  const location = useLocation();
  const { data } = useDre();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Partial<Record<AlphaTaskId, AlphaTaskStatus>>>(() => loadJson(progressKey, {}));
  const [draft, setDraft] = useState<Draft>(() => loadJson(draftKey, emptyDraft()));
  const panelTitle = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const currentArea = areaForPath(location.pathname);
  const currentTaskId = taskForArea(currentArea);
  const draftExists = hasDraft(draft);
  const completed = Object.values(progress).filter((item) => item === 'completed' || item === 'help').length;

  useEffect(() => {
    try {
      localStorage.setItem(progressKey, JSON.stringify(progress));
      if (draftExists && !sent) localStorage.setItem(draftKey, JSON.stringify(draft));
      else localStorage.removeItem(draftKey);
      setStorageError(null);
    } catch {
      setStorageError('O navegador nao conseguiu guardar o rascunho do relato. Mantenha esta aba aberta.');
    }
  }, [draft, draftExists, progress, sent]);

  useEffect(() => {
    if (open) panelTitle.current?.focus();
  }, [open]);

  const selectedTask = useMemo(
    () => alphaTasks.find((task) => task.id === draft.details.taskId),
    [draft.details.taskId],
  );

  function close(): void {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function openPanel(taskId = currentTaskId): void {
    if (sent || !draftExists) {
      const selected = alphaTasks.find((task) => task.id === taskId);
      setDraft(emptyDraft(selected?.area ?? currentArea, taskId, data !== null, location.pathname));
      setSent(false);
      setError(null);
    }
    setOpen(true);
  }

  function updateRatings(key: keyof FeedbackRatings, value: string): void {
    const ratings = { ...(draft.details.ratings ?? {}) };
    if (value) ratings[key] = Number(value);
    else delete ratings[key];
    setDraft({ ...draft, details: { ...draft.details, ratings } });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (sending || sent || !draft.ease || !draft.outcome) return;
    setSending(true);
    setError(null);
    const nextProgress = draft.details.taskId === undefined ? progress : { ...progress, [draft.details.taskId]: draft.outcome };
    try {
      await apiClient.post('/feedback', {
        area: draft.area,
        taskId: draft.details.taskId,
        ease: Number(draft.ease),
        outcome: draft.outcome,
        comment: draft.comment,
        details: {
          ...draft.details,
          context: { area: draft.area, path: location.pathname, loadedDre: data !== null },
          journey: { scriptVersion: alphaScriptVersion, progress: nextProgress },
        },
      });
      setProgress(nextProgress);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel enviar. Tente novamente.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="alpha-feedback-bar" role="region" aria-label="Coleta de relatos da alpha">
        <span>Alpha fundadores · {completed}/{alphaTasks.length} tarefas avaliadas</span>
        <button ref={trigger} className="dre-btn secondary" type="button" onClick={() => openPanel()} aria-expanded={open} aria-controls="alpha-feedback-panel">
          <FeedbackIcon kind="review" />
          {draftExists && !sent ? 'Retomar relato' : 'Enviar relato'}
        </button>
      </div>
      {storageError !== null && <p className="dre-err alpha-storage-error">{storageError}</p>}
      <aside id="alpha-feedback-panel" className="alpha-feedback-panel" hidden={!open} aria-labelledby="alpha-feedback-title" onKeyDown={(event) => { if (event.key === 'Escape') close(); }}>
        <header>
          <div>
            <span className="dre-eyebrow">Relato de uso</span>
            <h2 id="alpha-feedback-title" ref={panelTitle} tabIndex={-1}>{sent ? 'Relato recebido' : 'Como foi a experiencia?'}</h2>
          </div>
          <button className="alpha-icon-button" type="button" aria-label="Recolher relato e continuar navegando" onClick={close}>
            <FeedbackIcon kind="close" />
          </button>
        </header>

        {sent ? (
          <div className="alpha-thanks">
            <FeedbackIcon kind="check" />
            <p>{selectedTask ? `${taskStatusLabels[draft.outcome as AlphaTaskStatus]}: ${selectedTask.title}. ` : ''}Seu relato foi recebido.</p>
            <button className="dre-btn" type="button" onClick={() => { setDraft(emptyDraft(currentArea, currentTaskId, data !== null, location.pathname)); setSent(false); }}>
              Novo relato
            </button>
            <button className="dre-btn secondary" type="button" onClick={close}>Continuar testando</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className="alpha-draft-note">
              Voce pode recolher este painel, consultar outras telas e voltar depois. O rascunho fica salvo neste navegador ate o envio.
            </p>
            <fieldset disabled={sending} className="alpha-feedback-fields">
              <label>
                Area testada
                <select value={draft.area} onChange={(event) => setDraft({ ...draft, area: event.target.value })}>
                  {Object.entries(areaLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                Tarefa
                <select value={draft.details.taskId ?? ''} onChange={(event) => {
                  const selected = alphaTasks.find((task) => task.id === event.target.value);
                  setDraft({ ...draft, area: selected?.area ?? draft.area, details: { ...draft.details, taskId: selected?.id } });
                }}>
                  <option value="">Experiencia geral ou exploracao livre</option>
                  {alphaTasks.map((task, index) => <option key={task.id} value={task.id}>{index + 1}. {task.title}</option>)}
                </select>
              </label>
              {selectedTask && (
                <div className="alpha-task-card">
                  <strong>{selectedTask.title}</strong>
                  <p>{selectedTask.instruction}</p>
                  <small>Concluiu quando: {selectedTask.done}</small>
                </div>
              )}
              <fieldset>
                <legend>Foi facil fazer o que voce queria?</legend>
                <div className="alpha-rating">
                  {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                    <label key={value}>
                      <input type="radio" name="ease" value={value} checked={draft.ease === String(value)} onChange={(event) => setDraft({ ...draft, ease: event.target.value })} required />
                      <span>{value}</span>
                    </label>
                  ))}
                </div>
                <small>1 · Muito dificil <span>7 · Muito facil</span></small>
              </fieldset>
              <label>
                Como terminou?
                <select required value={draft.outcome} onChange={(event) => setDraft({ ...draft, outcome: event.target.value as Draft['outcome'] })}>
                  <option value="" disabled>Selecione</option>
                  <option value="completed">Conclui sem ajuda</option>
                  <option value="help">Conclui com ajuda</option>
                  <option value="blocked">Nao consegui concluir</option>
                  <option value="skipped">Pulei por enquanto</option>
                </select>
              </label>
              <details className="alpha-quality">
                <summary>Avaliar resposta, interface e confianca · opcional</summary>
                <p>1 · Muito ruim / baixa confianca. 7 · Muito bom / alta confianca.</p>
                {([
                  ['answer', 'Qualidade da resposta ou leitura'],
                  ['interface', 'Clareza da interface'],
                  ['trust', 'Confianca nos numeros e fontes'],
                ] as const).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <select value={draft.details.ratings?.[key] ?? ''} onChange={(event) => updateRatings(key, event.target.value)}>
                      <option value="">Nao avaliei</option>
                      {[1, 2, 3, 4, 5, 6, 7].map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                ))}
              </details>
              <label>
                Relate como foi sua experiencia <span className="alpha-optional">Opcional</span>
                <textarea rows={4} maxLength={2000} value={draft.comment} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} placeholder="Conte o que esperava, o que aconteceu e o que ajudaria." />
              </label>
              <small>Ao enviar, voce compartilha este relato, a tela atual, a tarefa e suas notas de teste. Nao inclua dados pessoais.</small>
            </fieldset>
            {!draft.ease || !draft.outcome ? <p className="alpha-draft-note">Para enviar, escolha a nota de facilidade e informe como terminou.</p> : null}
            {error !== null && <p className="dre-err" role="alert">{error}</p>}
            <button className="dre-btn" type="submit" disabled={sending || !draft.ease || !draft.outcome}>{sending ? 'Enviando...' : 'Enviar relato'}</button>
          </form>
        )}
      </aside>
    </>
  );
}
