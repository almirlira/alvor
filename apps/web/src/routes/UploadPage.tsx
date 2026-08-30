import { useCallback, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/api-client';
import { useDre, type DreImport } from '../lib/dre-context';
import { monthShort } from '../lib/format';

export function UploadPage(): JSX.Element {
  const { data, setData } = useDre();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const result = await apiClient.postFile<DreImport>('/dre/upload', file);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nao consegui ler o arquivo.');
      } finally {
        setBusy(false);
      }
    },
    [setData],
  );

  const loadSample = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiClient.post<DreImport>('/dre/load-sample');
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao consegui carregar o exemplo.');
    } finally {
      setBusy(false);
    }
  }, [setData]);

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void send(file);
  };

  const s = data?.statement;

  return (
    <>
      <div className="dre-head">
        <div>
          <div className="dre-eyebrow">Fontes de dados</div>
          <h1 className="dre-title">Enviar arquivos</h1>
          <p className="dre-subtitle">Solte a planilha que o contador mandou. Contas nas linhas, meses nas colunas.</p>
        </div>
      </div>

      <div
        className={`dre-drop${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        aria-label="Enviar arquivo da DRE"
      >
        <span className="material-symbols-rounded" aria-hidden="true">upload_file</span>
        <p className="dre-drop-title">{busy ? 'Lendo a planilha…' : 'Arraste a DRE aqui ou clique para escolher'}</p>
        <p className="dre-drop-hint">XLSX ou CSV · ate 20 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); e.target.value = ''; }}
        />
      </div>

      <div className="dre-actions">
        <button type="button" className="dre-btn secondary" disabled={busy} onClick={() => void loadSample()}>
          Usar DRE de exemplo (12 meses)
        </button>
      </div>

      {error !== null && <div className="dre-err">{error}</div>}

      {s !== undefined && (
        <div className="dre-grid-2">
          <section className="dre-card">
            <h3>DRE lida: {s.fileName}</h3>
            <div className="dre-stat-row">
              <div className="dre-stat"><b>{s.summary.months}</b><span>meses ({monthShort(s.months[0] ?? '')} a {monthShort(s.months[s.months.length - 1] ?? '')})</span></div>
              <div className="dre-stat"><b>{s.summary.linesMapped}</b><span>linhas reconhecidas</span></div>
              <div className="dre-stat"><b>{s.summary.linesUnmapped}</b><span>nao classificadas</span></div>
            </div>
            {s.reconciliation.length === 0 ? (
              <div className="dre-ok">Subtotais da planilha conferidos: batem com o recalculado, centavo a centavo.</div>
            ) : (
              <div className="dre-warn">{s.reconciliation.length} subtotal(is) da planilha nao batem com o recalculado. Veja as linhas nao classificadas.</div>
            )}
            {s.summary.unmappedLabels.length > 0 && (
              <>
                <p className="dre-subtitle" style={{ marginTop: 12 }}>Fora dos totais (nao reconhecidas):</p>
                <div className="dre-chip-list">
                  {s.summary.unmappedLabels.map((l) => <span key={l} className="dre-chip">{l}</span>)}
                </div>
              </>
            )}
            <div className="dre-actions">
              <button type="button" className="dre-btn" onClick={() => navigate('/painel')}>Ver painel</button>
            </div>
          </section>
          <section className="dre-card">
            <h3>Avisos da leitura</h3>
            {s.warnings.length === 0 ? <p className="dre-subtitle">Nenhum aviso.</p> : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {s.warnings.map((w, i) => <li key={i} style={{ marginBottom: 6 }}>{w}</li>)}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
