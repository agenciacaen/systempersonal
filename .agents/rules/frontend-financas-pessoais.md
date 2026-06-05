# Frontend — Sistema de Organização Financeira Pessoal

## Objetivo do produto
Construir uma aplicação web responsiva para organização financeira pessoal, conectada a um agente via Evolution API para registrar entradas e saídas em linguagem natural, sincronizar dados em tempo real com Supabase e apresentar balanço mensal, economia, gastos por categoria e fluxo de caixa.

## Papel deste agente
Este agente deve agir como arquiteto e executor do frontend. A responsabilidade é entregar uma interface clara, rápida e mobile-first, com foco em uso diário, lançamento rápido de transações e leitura simples do saldo do mês.

## Stack obrigatória
- Next.js 15 com App Router.
- TypeScript.
- Tailwind CSS.
- shadcn/ui para componentes base.
- Supabase JS para autenticação, realtime e leitura de dados.
- React Hook Form + Zod para formulários.
- Recharts para gráficos.
- date-fns para datas.
- Zustand ou Context API leve para estado local de filtros e UI.

## Direção de produto
A interface deve parecer um painel financeiro pessoal, não um ERP. O foco é simplicidade, velocidade e leitura. O usuário precisa abrir o sistema e entender em menos de 5 segundos: saldo atual, quanto entrou, quanto saiu, quanto economizou e onde está gastando.

## Direção visual
- Estética limpa e profissional.
- Layout tipo dashboard premium.
- Tema claro e escuro.
- Cartões com bom espaçamento, sem poluição visual.
- Hierarquia forte de números e métricas.
- Verde para entradas/economia, vermelho ou laranja para saídas, neutros para estrutura.
- Evitar excesso de gradientes, efeitos neon e aparência genérica de IA.

## Páginas obrigatórias

### 1. Login
- Login por magic link ou OTP via Supabase Auth.
- Tela simples, com branding do sistema.
- Possibilidade futura de múltiplos perfis.

### 2. Dashboard
Exibir:
- Saldo atual.
- Entradas do mês.
- Saídas do mês.
- Economia do mês.
- Meta mensal de economia.
- Progresso da meta.
- Gráfico de entradas vs saídas por mês.
- Gráfico por categoria.
- Lista das últimas transações.
- Alertas como “gastos acima da média” e “economia abaixo da meta”.

### 3. Transações
- Lista completa com filtros por período, tipo, categoria, conta e origem.
- Busca textual.
- Paginação ou infinite scroll.
- Ações de editar, excluir e marcar como recorrente.

### 4. Nova transação manual
Campos:
- tipo: entrada ou saída.
- valor.
- descrição.
- categoria.
- data.
- conta.
- observações.
- origem: manual, whatsapp, automação.

### 5. Metas e orçamento
- Definir meta de economia mensal.
- Definir teto por categoria.
- Visualizar percentual já comprometido.
- Destacar categorias com risco de estouro.

### 6. Configurações
- Perfil do usuário.
- Webhook status.
- Chave de integração do agente.
- Preferências de categorização.
- Contas financeiras.
- Exportação CSV.

## Componentes obrigatórios
- Sidebar ou bottom nav no mobile.
- Header com seletor de período.
- Cards de KPI.
- Tabela de transações.
- Drawer/modal para adicionar transação.
- Filtros persistentes na sessão.
- Gráfico de barras mensal.
- Gráfico de pizza ou barra horizontal por categoria.
- Indicadores de tendência vs mês anterior.
- Toasts para sucesso e erro.
- Empty states bem desenhados.
- Skeleton loaders.

## Estrutura sugerida de rotas
```txt
/app
  /(auth)/login
  /(dashboard)/dashboard
  /(dashboard)/transacoes
  /(dashboard)/metas
  /(dashboard)/configuracoes
  /api/webhook/evolution
```

## Estrutura sugerida de componentes
```txt
/components
  /layout
  /charts
  /transactions
  /goals
  /ui
```

## Regras de UX
- Mobile-first de verdade.
- Ação principal sempre visível: adicionar lançamento.
- Lançamentos recentes precisam estar acessíveis em 1 clique.
- Valores monetários com máscara brasileira.
- Datas no padrão pt-BR.
- Categorias com cores discretas.
- Tabelas devem funcionar bem no celular, preferindo cards quando necessário.
- O sistema deve reduzir atrito para registrar gastos rapidamente.

## Regras de performance
- Server Components onde fizer sentido.
- Client Components apenas para interações, gráficos e formulários.
- Paginação em listas grandes.
- Cache de consultas previsíveis.
- Realtime apenas nas áreas que agregam valor imediato.
- Evitar renders desnecessários.

## Regras de dados no frontend
O frontend nunca deve confiar em cálculos críticos feitos apenas no cliente. Totais mensais, saldo consolidado e agregações precisam vir do backend ou de views RPC no Supabase. O cliente apenas apresenta, filtra e complementa a experiência visual.

## Integração com o agente via Evolution API
O frontend deve considerar que transações podem entrar por mensagens como:
- “gastei 45 no mercado”
- “recebi 1500 de um freela”
- “paguei 89 da internet hoje”

O app deve exibir claramente a origem da transação e permitir revisão humana quando a categorização automática tiver baixa confiança.

## Estados importantes
- sem transações.
- sem metas cadastradas.
- webhook desconectado.
- falha de sincronização.
- transação pendente de revisão.
- erro de autenticação.

## Segurança e permissões
- Toda tela autenticada deve validar sessão.
- Não expor service role key no frontend.
- Toda escrita sensível passa por backend seguro ou políticas RLS.
- O usuário só vê os próprios dados.

## Critérios de aceite
- Dashboard carrega métricas mensais corretamente.
- Nova transação manual funciona.
- Transações enviadas pelo agente aparecem no sistema.
- Usuário consegue filtrar e revisar lançamentos.
- Metas mensais refletem no painel.
- UI funciona bem no desktop e mobile.
- Tema escuro e claro consistentes.

## Prompt operacional para vibecoding
Implemente um frontend completo de um sistema web de finanças pessoais com Next.js, TypeScript, Tailwind e shadcn/ui. O sistema precisa consumir dados do Supabase, exibir dashboard financeiro mensal, CRUD de transações, metas de economia, filtros, gráficos e estados de sincronização com um agente conectado pela Evolution API. Gere uma arquitetura limpa, componentes reutilizáveis, UI premium e mobile-first, com foco em rapidez de lançamento de entradas e saídas.
