# Plano de acesso remoto para fundadores — ALVOR

> Atualização de 10/09/2026: a alpha passou a usar a VPS já contratada, sob
> `https://brainora.ai/alvor/`, com convites individuais e nomes identificados.
> Consulte [acesso e operação atuais](./ACESSO-REMOTO.md). O diagnóstico e as
> alternativas abaixo registram o plano inicial, anterior à implementação.

## Objetivo

Colocar a versao atual do ALVOR em uma URL acessivel remotamente pela equipe de fundadores, com login individual, dados isolados por usuario e uso real do produto para gerar observacoes de evolucao.

Prioridade da fase: custo zero ou minimo, seguranca suficiente para teste interno e menor retrabalho possivel sobre o prototipo existente.

## Estado atual do codigo

O repositorio `almirlira/alvor` ja contem um prototipo funcional:

- web em React/Vite (`apps/web`);
- API em Fastify (`apps/api`);
- leitura de DRE XLSX/CSV (`packages/ingest`);
- motor deterministico do Semaforo de Autonomia;
- Copilot com IA e guardiao anti-invencao;
- DRE de exemplo em `samples/dre_exemplo_12m.xlsx`.

Pontos que impedem acesso remoto seguro hoje:

- nao ha autenticacao;
- a API salva estado em JSON local dentro de `data/`;
- a API escuta em `127.0.0.1`, adequada para desenvolvimento local;
- todos os usuarios compartilhariam a mesma DRE, insights e historico de chat se o app fosse publicado como esta;
- o repositorio esta publico, o que nao impede deploy, mas exige disciplina total com segredos e dados reais.

## Decisao pratica para a alpha urgente

Para apresentar acesso aos fundadores com urgencia, o caminho inicial segue o padrao da validacao remota do VOKO V2: convite individual, sem cadastro, com cada convite abrindo um espaco isolado.

Nesta primeira entrega:

- cada fundador recebe um codigo individual;
- o app exige o codigo quando `VITE_ALPHA_INVITE_AUTH=on`;
- a API valida o codigo por `ALPHA_INVITES`;
- os dados ficam separados por participante;
- DRE, insights, chat e relatos nao se misturam;
- a coleta de relatos usa painel contextual no produto, com rascunho local, tarefa, facilidade 1-7, conclusao e notas opcionais.

Isto permite apresentar hoje usando custo zero. Para expor rapidamente sem contratar infra, rodar localmente e abrir um tunel com `cloudflared tunnel --url http://127.0.0.1:5180`. Para uma alpha mais estavel de varios dias, usar Supabase + deploy permanente.

## Arquitetura recomendada para alpha fechada permanente

### Stack

| Camada | Recomendacao | Motivo |
|---|---|---|
| Frontend | Vercel ou Cloudflare Pages | custo zero, deploy automatico pelo GitHub |
| API | Render Web Service gratuito inicialmente | roda Fastify com poucas alteracoes |
| Auth | Supabase Auth | login por convite/e-mail, rapido de integrar |
| Banco | Supabase Postgres | isolamento por usuario com Row Level Security |
| Arquivos | Supabase Storage | guardar DRE original por usuario/workspace |
| Observacoes | tabela `feedback_notes` no Supabase | centralizar feedback dentro do produto |

Alternativa mais barata de manter e mais simples no primeiro ciclo: Vercel para web + Render para API + Supabase Free. Se o Render gratuito dormir depois de inatividade, aceitar isso na alpha; o primeiro acesso pode demorar alguns segundos.

## Modelo de isolamento

Cada fundador deve ter:

- um usuario proprio no Supabase Auth;
- um workspace proprio de teste;
- uma copia independente da DRE de exemplo;
- seus proprios uploads, insights, historico de chat e observacoes.

No banco, a regra deve ser: usuario so acessa dados de workspaces onde ele tem membership.

Tabelas iniciais:

- `profiles`: dados basicos do usuario;
- `workspaces`: espaco de teste ou empresa analisada;
- `workspace_members`: relacao usuario + workspace + papel;
- `dre_imports`: DRE processada, inicialmente em JSONB para reduzir refatoracao;
- `insights`: resultado salvo por workspace;
- `chat_messages`: historico do Copilot por workspace;
- `feedback_notes`: observacoes dos fundadores;
- `audit_events`: eventos importantes, como upload, login, insight gerado.

## Sequencia de execucao

### Fase 1 — Preparar o repositorio

1. Tornar o repositorio privado, ou manter publico somente se nenhum dado real, chave ou documento sensivel entrar nele.
2. Criar branch `alpha-remota`.
3. Criar `.env.example` real com nomes das variaveis, sem valores secretos.
4. Documentar como rodar localmente com Supabase e modo mock de IA.

### Fase 2 — Criar Supabase

1. Criar projeto Supabase Free.
2. Desabilitar cadastro publico aberto.
3. Configurar login por convite/e-mail.
4. Criar as tabelas iniciais.
5. Ativar Row Level Security em todas as tabelas de dados.
6. Criar politicas de leitura/escrita baseadas em `workspace_members`.
7. Criar bucket privado para uploads de DRE.

### Fase 3 — Adaptar a API

1. Adicionar verificacao de JWT do Supabase em todas as rotas privadas.
2. Criar `req.user` e `req.workspaceId`.
3. Trocar o `store.ts` atual por uma camada de repositorio:
   - no ambiente local, pode continuar usando JSON;
   - no ambiente remoto, usa Supabase/Postgres.
4. Alterar rotas para ler e salvar por workspace:
   - `/dre/upload`;
   - `/dre/current`;
   - `/dre/load-sample`;
   - `/insights/current`;
   - `/insights/generate`;
   - `/copilot/history`;
   - `/copilot/ask`;
   - `/semaforo`.
5. Manter a DRE processada em JSONB nesta fase para nao reescrever o motor agora.

### Fase 4 — Adaptar o frontend

1. Criar tela de login.
2. Guardar sessao do Supabase no browser.
3. Enviar `Authorization: Bearer <token>` em todas as chamadas para a API.
4. Criar tela simples de escolha/criacao de workspace se necessario.
5. Criar modulo "Observacoes" dentro do ALVOR:
   - comentario;
   - tela/area relacionada;
   - prioridade;
   - status;
   - autor;
   - data.

### Fase 5 — Deploy alpha

1. Publicar API no Render com variaveis de ambiente:
   - `SUPABASE_URL`;
   - `SUPABASE_SERVICE_ROLE_KEY`;
   - `SUPABASE_JWT_SECRET` ou metodo equivalente de validacao;
   - `ANTHROPIC_API_KEY`;
   - `LLM_PROVIDER`;
   - `NODE_ENV=production`.
2. Publicar web na Vercel ou Cloudflare Pages com:
   - `VITE_SUPABASE_URL`;
   - `VITE_SUPABASE_ANON_KEY`;
   - `VITE_API_BASE_URL`.
3. Configurar CORS da API permitindo somente a URL da alpha.
4. Testar fluxo completo com um usuario fundador.
5. Convidar os demais fundadores.

### Fase 6 — Rodada de teste interno

1. Cada fundador entra com seu login.
2. Cada fundador carrega a DRE de exemplo ou sua propria DRE de teste.
3. Cada fundador usa Painel, Semaforo, Upload e Copilot.
4. Toda observacao deve ser registrada dentro do app.
5. Ao final de 7 dias, consolidar feedback por prioridade.

## Checklist de seguranca minima

- [ ] Repositorio privado antes de inserir configuracoes sensiveis.
- [ ] Nenhuma chave em commit.
- [ ] Signup publico fechado.
- [ ] Convite manual para fundadores.
- [ ] RLS ativa em todas as tabelas com dados de usuario.
- [ ] Bucket de DRE privado.
- [ ] API exigindo JWT em rotas privadas.
- [ ] Service role key usada somente no servidor.
- [ ] CORS restrito a URL oficial da alpha.
- [ ] Limite de upload mantido em 20 MB.
- [ ] Logs sem conteudo completo da DRE.
- [ ] Backup/export semanal no Supabase.

## Custos esperados

Fase alpha pequena:

- Supabase Free: suficiente para fundadores e poucos testes.
- Vercel/Cloudflare Pages Free: suficiente para frontend.
- Render Free: suficiente para API com possivel dormencia.
- Dominio proprio: opcional.

Quando considerar pagar:

- se a API dormindo atrapalhar testes: usar plano pago pequeno de API;
- se houver dados reais de clientes: considerar Supabase Pro por backup, limites maiores e operacao mais seria;
- se o time externo crescer: dominio proprio, monitoramento e ambiente separado de producao/staging.

## Definicao de pronto da alpha remota

A alpha esta pronta quando:

- cada fundador acessa com login proprio;
- um fundador nao consegue ver dados de outro;
- upload de DRE funciona remotamente;
- Painel, Semaforo e Copilot funcionam com dados do usuario logado;
- as observacoes ficam salvas por autor;
- o app tem uma URL compartilhavel;
- o time consegue testar por uma semana sem depender do computador local de ninguem.
