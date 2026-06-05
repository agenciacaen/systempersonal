# Backend Supabase — Sistema de Organização Financeira Pessoal

## Objetivo do backend
Construir o backend no Supabase para autenticação, armazenamento, sincronização em tempo real e consolidação financeira mensal de um sistema pessoal de entradas e saídas integrado a um agente via Evolution API.

## Papel deste agente
Este agente deve agir como arquiteto de backend e banco de dados. A responsabilidade é modelar a base, criar tabelas, relacionamentos, policies, functions, triggers, views e endpoints necessários para registrar transações manuais e automatizadas, consolidar balanços mensais e suportar sincronização com frontend web.

## Stack obrigatória
- Supabase Postgres.
- Supabase Auth.
- Row Level Security.
- SQL migrations.
- RPC functions para cálculos.
- Edge Functions para webhook seguro, quando necessário.
- Realtime para atualização do dashboard.
- Storage opcional apenas para anexos e comprovantes.

## Casos de uso principais
- Usuário autentica na aplicação.
- Usuário cria transações manualmente.
- Agente envia transações de entrada e saída via webhook.
- Sistema categoriza e salva transações.
- Usuário revisa e corrige transações automáticas.
- Sistema calcula saldo, total de entradas, total de saídas e economia mensal.
- Sistema compara meses e gera indicadores.
- Sistema registra metas de economia e limites por categoria.

## Modelagem de domínio

### Tabelas obrigatórias

#### 1. profiles
Campos:
- id UUID PK referenciando auth.users.
- full_name.
- phone.
- timezone.
- currency default BRL.
- created_at.
- updated_at.

#### 2. accounts
Representa carteiras e contas.
Campos:
- id UUID PK.
- user_id UUID FK.
- name.
- type: cash, checking, savings, credit_card, investment.
- initial_balance numeric.
- active boolean.
- created_at.

#### 3. categories
Campos:
- id UUID PK.
- user_id UUID FK nullable para permitir categorias padrão do sistema.
- name.
- type: income ou expense.
- color.
- icon.
- is_default boolean.
- created_at.

#### 4. transactions
Tabela central.
Campos:
- id UUID PK.
- user_id UUID FK.
- account_id UUID FK.
- category_id UUID FK.
- type: income ou expense.
- amount numeric(14,2).
- description text.
- notes text.
- transaction_date date.
- competence_month date.
- source: manual, whatsapp, webhook, import.
- external_message_id text.
- status: confirmed, pending_review, ignored.
- confidence_score numeric(5,2).
- raw_input text.
- created_at.
- updated_at.

#### 5. monthly_goals
Campos:
- id UUID PK.
- user_id UUID FK.
- reference_month date.
- savings_goal numeric(14,2).
- expense_limit numeric(14,2) nullable.
- created_at.
- updated_at.
- unique(user_id, reference_month).

#### 6. category_budgets
Campos:
- id UUID PK.
- user_id UUID FK.
- category_id UUID FK.
- reference_month date.
- limit_amount numeric(14,2).
- created_at.
- unique(user_id, category_id, reference_month).

#### 7. webhook_events
Auditoria de entrada externa.
Campos:
- id UUID PK.
- provider text.
- user_id UUID FK nullable.
- event_type text.
- payload jsonb.
- processed boolean.
- error_message text.
- created_at.
- processed_at.

#### 8. sync_logs
Campos:
- id UUID PK.
- user_id UUID FK.
- source text.
- status text.
- detail text.
- created_at.

## Regras de modelagem
- Todas as tabelas de negócio devem ter created_at.
- Tabelas editáveis devem ter updated_at.
- UUID como chave primária.
- Índices por user_id, transaction_date, competence_month, category_id e status.
- Constraints para impedir amount <= 0.
- Enum ou check constraints para type, status e source.

## Regras de negócio
- Entrada soma no saldo; saída subtrai.
- competence_month deve representar o primeiro dia do mês de competência.
- Transações pendentes de revisão não entram no balanço oficial até serem confirmadas, ou devem ser incluídas apenas em visão separada; defina explicitamente e mantenha consistência.
- Transações com mesmo external_message_id devem ser tratadas com idempotência.
- Categorias automáticas podem ser corrigidas pelo usuário.
- Exclusão idealmente lógica em eventos externos críticos, ou auditoria completa.

## Views e cálculos obrigatórios

### 1. view_monthly_summary
Por usuário e mês:
- total_income.
- total_expense.
- net_balance.
- savings_value.
- total_transactions.

### 2. view_category_summary_month
Por usuário, mês e categoria:
- total_amount.
- transaction_count.
- percentage_of_expense.

### 3. view_account_balances
Saldo por conta com base no saldo inicial e transações confirmadas.

## RPC functions obrigatórias

### 1. get_dashboard_summary(p_user_id, p_reference_month)
Retorna:
- saldo do mês.
- entradas.
- saídas.
- economia.
- comparação com mês anterior.
- progresso da meta.

### 2. get_monthly_trend(p_user_id, p_months)
Retorna série temporal para gráfico de entradas vs saídas.

### 3. get_category_breakdown(p_user_id, p_reference_month)
Retorna gastos por categoria.

### 4. ingest_transaction_from_agent(payload jsonb)
Recebe payload externo, registra webhook_event, aplica idempotência, normaliza dados e grava transaction.

## Webhook e Evolution API
O backend precisa aceitar eventos do agente via endpoint seguro. A recomendação é usar Supabase Edge Function ou backend intermediário. Esse endpoint deve:
- validar assinatura ou token secreto.
- registrar payload bruto em webhook_events.
- identificar usuário de destino.
- interpretar tipo da transação.
- extrair valor, descrição, data e categoria sugerida.
- gravar transaction com source webhook ou whatsapp.
- marcar confidence_score.
- responder rapidamente com status 200.

## Exemplo de interpretação esperada
Entrada de texto:
- “gastei 120 no mercado”
Saída esperada:
- type: expense
- amount: 120.00
- description: mercado
- category: alimentação
- status: pending_review ou confirmed conforme confiança

## Segurança
- RLS em todas as tabelas de negócio.
- Usuário só acessa linhas onde user_id = auth.uid().
- service role usada apenas em Edge Functions e automações seguras.
- Policies separadas para select, insert, update e delete.
- Webhook externo nunca expõe credenciais sensíveis ao cliente.

## Policies mínimas
- profiles: usuário lê e atualiza apenas o próprio perfil.
- accounts, categories, transactions, monthly_goals, category_budgets, sync_logs: acesso apenas ao dono.
- webhook_events: somente service role ou ambiente administrativo.

## Triggers recomendadas
- trigger para updated_at.
- trigger para preencher competence_month a partir de transaction_date.
- trigger para criar profile automático após signup.
- trigger opcional para notificar realtime após inserção de transaction.

## Estratégia de categorização
A categorização automática deve aceitar três níveis:
- alta confiança: salva como confirmed.
- média confiança: salva como pending_review.
- baixa confiança: salva como pending_review com destaque no frontend.

## Regras de observabilidade
- Logar falhas de ingestão.
- Logar duplicidade detectada.
- Logar payload inválido.
- Criar rastreabilidade entre webhook_events e transactions.

## Estrutura esperada de migrations
```txt
supabase/
  migrations/
    001_init_extensions.sql
    002_create_profiles.sql
    003_create_accounts.sql
    004_create_categories.sql
    005_create_transactions.sql
    006_create_goals_and_budgets.sql
    007_create_webhook_events_and_logs.sql
    008_create_views.sql
    009_create_functions.sql
    010_create_triggers.sql
    011_enable_rls_and_policies.sql
    012_seed_default_categories.sql
  functions/
    evolution-webhook/index.ts
```

## Seeds recomendados
Categorias padrão:
- Alimentação.
- Moradia.
- Transporte.
- Saúde.
- Lazer.
- Assinaturas.
- Educação.
- Salário.
- Freelance.
- Investimentos.
- Outros.

## Critérios de aceite
- Usuário autentica e enxerga apenas os próprios dados.
- Transações manuais e automáticas são persistidas corretamente.
- Idempotência impede duplicação por mensagem repetida.
- Dashboard mensal pode ser montado por RPC/view sem lógica pesada no frontend.
- Metas mensais e orçamento por categoria funcionam.
- RLS está ativo e testado.
- Webhook de agente está preparado para produção.

## Prompt operacional para vibecoding
Implemente o backend Supabase completo para um sistema de finanças pessoais com autenticação, tabelas relacionais, RLS, triggers, views, RPC functions e Edge Function para ingestão de transações via Evolution API. Modele transações manuais e automatizadas, metas mensais, orçamento por categoria, auditoria de webhooks, idempotência por external_message_id e consultas prontas para dashboard financeiro mensal.
