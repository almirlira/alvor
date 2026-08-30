# ALVOR — protótipo (hackathon)

Lê a DRE mensal de uma PME (planilha), mostra o painel do mês, classifica cada problema no **Semáforo de Autonomia** e entrega insights práticos de lucro com IA — **todo número citado tem fonte na própria DRE**; se não tem o dado, ele diz que não tem.

## Semáforo de Autonomia

Cada problema ou oportunidade vira um card com a cor do nível de autonomia do dono:

| Cor | Significado | Exemplos |
|---|---|---|
| **Verde** | O dono executa sozinho | renegociar fornecedor, cortar assinatura, ajustar preço, teto de marketing |
| **Amarelo** | Exige validação do contador ou do gerente do banco | impostos sobre vendas, pró-labore, juros, campos CBS/IBS nas notas |
| **Vermelho** | Nunca sai daqui sem parecer profissional | regime tributário, prejuízo acumulado, apuração retroativa |

Cada card traz: o problema, a **trilha** (números com origem na linha da DRE ou no KPI), as ações, o **pedido de validação já escrito** para copiar e mandar ao profissional e — quando fiscal — os 4 campos obrigatórios (norma citada, vigência, confiança, semáforo). Nunca é parecer: é hipótese fundamentada.

Os 3 cards mais importantes (um por cor) ficam no hero do Painel; a tela **Semáforo** lista todos, com filtro por cor e seleção de mês. Motor determinístico em `apps/api/src/semaforo.ts` (`GET /semaforo?month=`), sem IA — instantâneo e sempre com fonte.

Visual: design system ALVOR (`design/alvor_bento_design_system.html`) aplicado por `apps/web/src/styles/alvor-theme.css`, que remapeia os tokens herdados do CROSS para a paleta bento escura. Paleta do semáforo: verde `#859364`, amarelo `#EFC059`, vermelho `#ED615A` — os mesmos tons governam os gráficos.

## Ticker (barra fixa de rodapé)

`apps/web/src/components/TickerBar.tsx` — barra fixa estilo mercado, sempre visível, com rolagem contínua: **lucro bruto, lucro líquido, custos e despesas** em destaque, mais receita líquida, margem bruta e ponto de equilíbrio. Cada item traz a variação contra o mês anterior com **semântica invertida para custo**: despesa subindo é vermelho, despesa caindo é verde. Quando a comparação não é honesta (mudança de sinal ou base desprezível) mostra "—" em vez de um percentual sem sentido. Pausa ao passar o mouse e congela em `prefers-reduced-motion`.

Construído sobre três motores do CROSS (`mktvibe-v2`): leitor genérico de planilha, guardião anti-invenção da IA e base de conhecimento + motor de regras. Conteúdo financeiro novo em `packages/kb/content/`.

## Rodar (3 comandos)

```bash
cp .env.example .env        # cole a ANTHROPIC_API_KEY (sem chave, roda em modo simulado)
pnpm install
pnpm dev                    # API :3800 + web :5180
```

Abra http://localhost:5180 → **Enviar DRE** (arraste o XLSX/CSV ou "Usar DRE de exemplo") → **Painel** → **Copilot**.

## Chaves de escape (`.env`)

| Variável | Efeito |
|---|---|
| `LLM_PROVIDER=mock` | Sem chamadas de IA: insights e respostas vêm só das regras (plano C da demo) |
| `ANTHROPIC_MODEL=claude-sonnet-5` | Mais rápido que o Opus 5 se a latência atrapalhar |
| Raciocínio | `medium` no código (`engine.ts`). `low` responde em ~9 s, mas a qualidade do conselho cai — testado |
| `API_PORT=3800` | Porta da API (o web usa proxy `/api` → `:3800`) |

## Estado verificado (2026-08-30, DRE de exemplo)

- Leitura: 12 meses, 32 linhas, 0 não classificadas, subtotais batendo com o recalculado.
- 6 regras de diagnóstico disparam; insight e as 3 perguntas da demo **aprovados pelo guardião com Claude Opus 5 real**, na primeira tentativa.
- Latência: ~15 s por resposta (raciocínio `medium`). O insight do mês fica salvo e abre instantâneo; só as perguntas ao vivo esperam.
- Ainda não testado: DRE real do cliente.

## Roteiro da demo (5 min)

1. **Enviar DRE** → soltar a planilha → "12 meses, 32 linhas reconhecidas, 0 não classificadas · subtotais batem centavo a centavo".
2. **Painel** → hero: resultado do mês no vermelho, margem bruta cedendo → **Semáforo**: um card de cada cor (vermelho: regime tributário pede parecer; amarelo: CBS/IBS nas notas, valide com o contador; verde: margem bruta, você resolve no preço e no fornecedor) → clicar no "?" de um quadrante → "Explica pra mim".
3. **Semáforo** → filtrar por cor → abrir o card vermelho → mostrar a trilha, as ações e o botão **Copiar pedido** (texto pronto para o contador) + os 4 campos (norma, vigência, confiança, semáforo).
4. **Copilot** → "Gerar insights do mês" → ler o diagnóstico (regras disparadas aparecem como chips) → clicar num número sublinhado → painel lateral mostra linha/mês de origem.
5. Perguntar: *"Qual despesa mais cresceu em relação ao mês anterior?"* e *"O que eu corto primeiro sem derrubar a receita?"*.
6. Fechar: "Todo número que ele fala está na sua DRE — ele não inventa; se não tem o dado, diz que não tem."

Se a IA cair no palco: o último insight fica salvo em `data/insights.json` e continua na tela; com `LLM_PROVIDER=mock` tudo segue funcionando sem rede.

## Formato de DRE aceito

Contas nas **linhas**, meses nas **colunas** (`jan/26`, `01/2026`, `Janeiro`, datas). Linhas de grupo (valor = soma das filhas) e subtotais `(=)` são detectados automaticamente; o que não for reconhecido aparece na tela como "não classificado" e fica fora dos totais.

## Estrutura

```
packages/ingest   leitor de planilha (CROSS) + dre-profile / account-detector / dre-model / dre-kpis
packages/ai       guardião anti-invenção, prompt, provedor Anthropic (CROSS, prompt adaptado para finanças)
packages/kb       runtime da base de conhecimento (CROSS) + finance_kb.json + fiscal_reference.json
apps/api          Fastify: /dre/upload · /dre/current · /insights/generate · /copilot/ask · /kb/kpi/:id
apps/web          Vite/React: Enviar DRE · Painel · Copilot (tokens visuais do CROSS)
scripts           make-sample-dre.mjs · smoke-parse.ts · smoke-api.ts
```

## Verificação rápida

```bash
pnpm typecheck
npx tsx scripts/smoke-parse.ts samples/dre_exemplo_12m.xlsx   # leitura + KPIs
npx tsx scripts/smoke-api.ts "Qual despesa mais cresceu?"     # API ponta a ponta
```
