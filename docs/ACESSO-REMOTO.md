# ALVOR — acesso dos fundadores

## Endereços

| Finalidade | URL |
| --- | --- |
| Produto | https://brainora.ai/alvor/ |
| Entrada dos fundadores | https://brainora.ai/alvor/fundadores |
| Relatos do usuário conectado | https://brainora.ai/alvor/relatos |
| Acompanhamento do organizador | https://brainora.ai/alvor/gestao |

Todos os atalhos exigem o código individual. Somente P00 pode consultar a gestão.
As rotas anteriores `/observacoes` e `/alpha` continuam funcionando como atalhos.
Os códigos ficam em `private/convites-alpha.md`, fora do Git. Compartilhe somente o código da pessoa.

## Nomes

A lista de participantes em `private/convites-alpha.md` é a referência para os nomes.
`node scripts/sync-alpha-names.mjs` sincroniza o documento com a configuração local,
sem gerar códigos novos. `node scripts/deploy-alpha.mjs` também faz essa sincronização
e aplica os nomes no servidor, mantendo os códigos remotos e os dados existentes.

A identidade exibida na interface vem da validação do código no servidor. O nome
aparece no menu e nos novos registros de uso e relatos. Registros históricos não
são reescritos; o identificador P00–P05 mantém o vínculo com o participante atual.
Sessões já abertas precisam recarregar a página para mostrar um nome alterado.
Os contadores iniciais incluem as checagens técnicas de implantação; esses acessos
não representam testes realizados pelos fundadores.

## Hospedagem e limites

A alpha usa a VPS já contratada e o domínio Brainora, sem contratação adicional.
O Mac e o túnel temporário não são necessários para os novos endereços.
Enquanto estiver ativo, o túnel antigo redireciona para o novo endereço usando
`scripts/redirect-alpha.mjs` (PM2: `alvor-redirect`). A API e a web locais foram
paradas para evitar duas cópias independentes dos dados.
O frontend compilado é servido pelo Caddy; a API roda em um serviço separado.
Compartilha a origem `brainora.ai` com a página institucional; o acesso continua
restrito por convite e os dados são separados por participante.

O Copilot permanece em modo simulado, sem chamadas de IA externas.
Upload, análise determinística da DRE e relatos usam dados persistentes.
Os dados estão em arquivos JSON na VPS, ainda sem backup externo automático.

| Item | Configuração |
| --- | --- |
| Serviço | `alvor-alpha.service`, habilitado no boot e com reinício automático |
| Processo | usuário `alvor-alpha`, sem shell; até 512 MB e 50% de um núcleo |
| API | `127.0.0.1:3900`, exposta somente pelo proxy HTTPS |
| Código | `/opt/alvor-alpha/releases/`; `current` aponta para a versão ativa |
| Dados | `/var/lib/alvor-alpha`, restritos ao usuário do serviço |
| Segredos | `/etc/alvor-alpha.env`, permissão 0600 |
| Web | somente `apps/web/dist`; código-fonte e dados fora da raiz pública |

## Publicar e operar

Na raiz do repositório, com o SSH já configurado:

```sh
node scripts/deploy-alpha.mjs
ssh root@204.168.173.123 systemctl status alvor-alpha
ssh root@204.168.173.123 journalctl -u alvor-alpha -n 80 --no-pager
```

O deploy valida tipos, compila para `/alvor/`, confere o pacote, instala dependências,
preserva dados/segredos e verifica a saúde. A primeira implantação migra os dados dos
convites locais; atualizações seguintes preservam o estado remoto. O resultado fica
em `private/deployment-alpha.json`. O proxy compartilhado tem backup e conferência de
configuração antes da alteração; o reload usa `caddy reload`, conforme a operação
existente da VPS e a [documentação do Caddy](https://caddyserver.com/docs/command-line).

Para interromper somente o ALVOR: `ssh root@204.168.173.123 systemctl stop alvor-alpha`.
Para rollback, selecione uma release anterior em `/opt/alvor-alpha/releases/`, atualize
o link `current` e reinicie `alvor-alpha`. Não substitua `/var/lib/alvor-alpha`.
