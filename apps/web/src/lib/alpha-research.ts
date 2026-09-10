export const alphaScriptVersion = '2026-09-10';

export const alphaTasks = [
  {
    id: 'upload',
    area: 'upload',
    title: 'Enviar ou carregar uma DRE',
    instruction: 'Use a DRE de exemplo ou envie uma planilha. Confira se os meses, linhas reconhecidas e subtotais fazem sentido.',
    done: 'Voce chegou ao estado em que o ALVOR tem uma DRE carregada para analisar.',
    limit: 'O teste aceita XLSX, XLS e CSV. Se a planilha real tiver formato diferente, relate onde travou.',
  },
  {
    id: 'painel',
    area: 'painel',
    title: 'Entender o mes no Painel',
    instruction: 'Abra o Painel, leia os KPIs e tente explicar em voz alta como o mes fechou.',
    done: 'Voce consegue dizer se o mes foi bom ou ruim e qual numero sustenta essa leitura.',
    limit: 'O Painel mostra leitura financeira da DRE carregada; ele ainda nao substitui contador ou consultor.',
  },
  {
    id: 'semaforo',
    area: 'semaforo',
    title: 'Usar o Semaforo de Autonomia',
    instruction: 'Abra o Semaforo, filtre uma cor e leia uma acao. Confira se ficou claro o que voce pode fazer sozinho e o que precisa validar.',
    done: 'Voce entendeu pelo menos uma acao verde, amarela ou vermelha e o motivo da classificacao.',
    limit: 'O Semaforo e uma orientacao de autonomia, nao um parecer fiscal ou juridico.',
  },
  {
    id: 'copilot',
    area: 'copilot',
    title: 'Perguntar ao Copilot',
    instruction: 'Faca uma pergunta sobre despesas, margem, lucro ou decisao do proximo mes. Clique em uma fonte citada se aparecer.',
    done: 'Voce recebeu uma resposta e conseguiu conferir de onde saiu pelo menos um numero.',
    limit: 'O Copilot responde somente com base na DRE e na base financeira do ALVOR. Se nao houver dado, ele deve dizer que nao tem.',
  },
] as const;

export type AlphaTaskId = typeof alphaTasks[number]['id'];
export type AlphaTaskStatus = 'pending' | 'completed' | 'help' | 'blocked' | 'skipped';

export const taskStatusLabels: Record<AlphaTaskStatus, string> = {
  pending: 'Ainda nao fiz',
  completed: 'Conclui sem ajuda',
  help: 'Conclui com ajuda',
  blocked: 'Nao consegui',
  skipped: 'Pulei por enquanto',
};

export const areaLabels: Record<string, string> = {
  geral: 'Experiencia geral',
  upload: 'Enviar arquivos',
  painel: 'Painel',
  semaforo: 'Semaforo',
  copilot: 'Copilot',
};

export interface FeedbackRatings {
  readonly answer?: number;
  readonly interface?: number;
  readonly trust?: number;
}

export interface AlphaFeedbackDetails {
  readonly taskId?: AlphaTaskId;
  readonly ratings?: FeedbackRatings;
  readonly context?: {
    readonly path: string;
    readonly area: string;
    readonly loadedDre: boolean;
  };
  readonly journey?: {
    readonly scriptVersion: string;
    readonly progress: Partial<Record<AlphaTaskId, AlphaTaskStatus>>;
  };
}

export function areaForPath(path: string): string {
  if (path.startsWith('/enviar') || path.startsWith('/sources')) return 'upload';
  if (path.startsWith('/painel') || path.startsWith('/dashboard')) return 'painel';
  if (path.startsWith('/semaforo')) return 'semaforo';
  if (path.startsWith('/copilot') || path.startsWith('/chat')) return 'copilot';
  return 'geral';
}

export function taskForArea(area: string): AlphaTaskId | undefined {
  return alphaTasks.find((task) => task.area === area)?.id;
}

