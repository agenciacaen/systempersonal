// Edge Function: evolution-webhook
// Agente financeiro conversacional via WhatsApp (Evolution API)
// v38: balance override — added "recalcule"/"limpe override" intent (no value)
// - Responde comandos (saldo, hoje, mês, metas, dica)
// - Define saldo de conta (override): "mude o saldo do X para Y" / "recalcule o saldo"
// - Ajustes manuais: "zere", "some", "tira", "retome"
// - Conversa livre com Gemini (contexto financeiro)
// - Comenta proativamente em gastos fora do padrão
// - Alerta quando atinge 80% de meta/orçamento

import { createClient } from "npm:@supabase/supabase-js@2.49.0";

interface ParsedTransaction {
  type: "income" | "expense";
  amount: number;
  description: string;
  confidence_score: number;
  category_name?: string;
}

const TYPE_EMOJI = { income: "💰", expense: "💸" };
const TYPE_LABEL = { income: "Receita", expense: "Despesa" };

// ============ HELPERS ============
function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatDateBR(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function startOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ============ FUZZY MATCH / ACCOUNT RESOLUTION ============
// Distância de Levenshtein simplificada — O(len(a)*len(b)) é OK p/ nomes curtos
function levenshtein(a: string, b: string): number {
  a = a.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  b = b.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// Detecta se o texto contém verbo de transação (não deve ser tratado como ajuste de saldo)
function hasTransactionVerb(text: string): boolean {
  return /\b(comprei|gastei|paguei|recebi|ganhei|entrou|caiu|chegou|saiu|debitei|compra|deposito|depositou)\b/i.test(text);
}

function normalizeText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

interface AccountRow {
  id: string;
  name: string;
  type: string;
  active: boolean;
}

// Tenta resolver nome de conta mencionado na mensagem.
// Estratégia em ordem:
//  1) match exato (normalizado)
//  2) substring: o nome da conta aparece dentro da mensagem (ou vice-versa)
//  3) Levenshtein com tolerância proporcional ao tamanho
async function resolveAccount(supabase: any, userId: string, text: string): Promise<AccountRow | null> {
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, type, active")
    .eq("user_id", userId)
    .eq("active", true);
  if (!accounts || accounts.length === 0) return null;

  const normText = normalizeText(text);

  // 1) match exato
  for (const a of accounts as AccountRow[]) {
    if (normalizeText(a.name) === normText) return a;
  }

  // 2) substring
  for (const a of accounts as AccountRow[]) {
    const norm = normalizeText(a.name);
    if (normText.includes(norm) || norm.includes(normText)) return a;
  }

  // 3) Levenshtein — testa cada token do texto contra cada nome de conta
  //    Score = soma de (cand.length × 10 − dist) para cada par casado.
  //    Assim, uma conta que casa MAIS tokens (ex: "conta" + "pj")
  //    ganha de uma que casa só um token genérico ("conta").
  const tokens = normText.split(/\s+/).filter((t) => t.length >= 3);
  let best: { acc: AccountRow; score: number } | null = null;
  for (const a of accounts as AccountRow[]) {
    const norm = normalizeText(a.name);
    const candidates = [norm, ...norm.split(/\s+/)];
    let score = 0;
    for (const cand of candidates) {
      if (cand.length < 3) continue;
      for (const tok of tokens) {
        const dist = levenshtein(tok, cand);
        const tolerance = Math.max(1, Math.floor(cand.length * 0.3));
        if (dist <= tolerance) {
          score += cand.length * 10 - dist;
        }
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { acc: a, score };
    }
  }
  return best?.acc ?? null;
}

// ============ PERIOD PARSING ============
interface PeriodRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  label: string; // p/ exibir
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parsePeriod(text: string): PeriodRange | null {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = isoDate(today);

  // 1) "hoje"
  if (/\bhoje\b/.test(t)) {
    return { start: todayStr, end: todayStr, label: "hoje" };
  }
  // 2) "ontem"
  if (/\bontem\b/.test(t)) {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    return { start: isoDate(y), end: isoDate(y), label: "ontem" };
  }
  // 3) "semana passada"
  if (/semana passada/.test(t)) {
    const day = today.getDay() || 7; // 1=seg ... 7=dom
    const monday = new Date(today); monday.setDate(today.getDate() - day - 6);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    return { start: isoDate(monday), end: isoDate(sunday), label: "semana passada" };
  }
  // 4) "essa semana" / "desta semana"
  if (/(essa|desta) semana/.test(t)) {
    const day = today.getDay() || 7;
    const monday = new Date(today); monday.setDate(today.getDate() - day + 1);
    return { start: isoDate(monday), end: todayStr, label: "essa semana" };
  }
  // 5) "mês passado" / "mes passado"
  if (/m(e|ê)s passado/.test(t)) {
    const m = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const e = new Date(today.getFullYear(), today.getMonth(), 0);
    const label = `${m.getFullYear()}-${pad(m.getMonth() + 1)}`;
    return { start: isoDate(m), end: isoDate(e), label };
  }
  // 6a) Mês específico por nome ("junho", "janeiro", etc) — pode ser passado/futuro, aceita
  const monthNames = ["janeiro","fevereiro","marco","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  for (let i = 0; i < 12; i++) {
    if (t.includes(monthNames[i])) {
      const year = /(\d{4})/.exec(t)?.[1] ? Number(/(\d{4})/.exec(t)![1]) : today.getFullYear();
      const m = new Date(year, i, 1);
      const e = new Date(year, i + 1, 0);
      // Se for o mês atual, cap em today
      const end = (year === today.getFullYear() && i === today.getMonth()) ? todayStr : isoDate(e);
      return { start: isoDate(m), end, label: monthNames[i] + `/${year}` };
    }
  }
  // 6b) "mes 06" / "mês 06" / "mês 6" → mês atual ou específico
  const mMM = /(?:^|\s)(?:mes|m\u00ea?s)\s*0?(\d{1,2})(?:\s|$|\.|,)/i.exec(text);
  if (mMM) {
    const num = Number(mMM[1]);
    if (num >= 1 && num <= 12) {
      const yearMatch = /(\d{4})/.exec(text);
      const year = yearMatch ? Number(yearMatch[1]) : today.getFullYear();
      const m = new Date(year, num - 1, 1);
      const e = new Date(year, num, 0);
      // Se for o mês atual, cap em today
      const end = (year === today.getFullYear() && (num - 1) === today.getMonth()) ? todayStr : isoDate(e);
      return { start: isoDate(m), end, label: `${year}-${pad(num)}` };
    }
  }
  // 6c) "esse mês" / "deste mês" / "mês atual" → cap em today
  if (/(esse|deste|atual)\s*m(e|ê)s/.test(t) || /neste\s*m(e|ê)s/.test(t)) {
    const m = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: isoDate(m), end: todayStr, label: `${today.getFullYear()}-${pad(today.getMonth() + 1)}` };
  }
  // 7) "últimos X dias"
  const lastX = /u\u00b4ltimos?\s*(\d{1,3})\s*dias?/.exec(t);
  if (lastX) {
    const n = Number(lastX[1]);
    const s = new Date(today); s.setDate(today.getDate() - n + 1);
    return { start: isoDate(s), end: todayStr, label: `últimos ${n} dias` };
  }
  // 8) "do dia X ao dia Y" / "de X a Y" / "entre X e Y" (mesmo mês, default = atual)
  const rangeMatch = /(?:do\s*dia|entre|de)\s*(\d{1,2})\s*(?:ao?\s*dia|a|e|at\u00e9)\s*(\d{1,2})/i.exec(text);
  if (rangeMatch) {
    const d1 = Number(rangeMatch[1]);
    const d2 = Number(rangeMatch[2]);
    if (d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31 && d2 >= d1) {
      const monthMatch = /(?:desse|deste|do\s*mes\s*|m(e|ê)s\s*)(\d{1,2})/.exec(t);
      let year = today.getFullYear();
      let month = today.getMonth();
      if (monthMatch) {
        month = Number(monthMatch[1]) - 1;
      }
      const s = new Date(year, month, d1);
      const e = new Date(year, month, d2);
      // Cap end em today se for mês atual e d2 > hoje
      let endDate = e;
      if (year === today.getFullYear() && month === today.getMonth() && e > today) {
        endDate = today;
      }
      return { start: isoDate(s), end: isoDate(endDate), label: `${d1}–${d2}/${pad(month + 1)}` };
    }
  }
  // 9) "esse ano" / "ano atual" — cap em today
  if (/(esse|deste|atual)\s*ano/.test(t)) {
    return {
      start: `${today.getFullYear()}-01-01`,
      end: todayStr,
      label: `${today.getFullYear()}`,
    };
  }
  return null;
}

// ============ PARSERS ============
function parseWithRegex(text: string): ParsedTransaction | null {
  const expensePatterns = [
    /(?:gastei|paguei|comprei|gasto|gasta|pag[uo]|debitei|sa[ií]da)\s*(?:de\s*)?(?:R\$\s*)?([\d.,]+)\s*(?:em|no|na|de|com|para|pra)?\s*(.+)?/i,
    /(?:fiz|teve)\s*(?:gasto|débito|compra|saída)\s*(?:de\s*)?(?:R\$\s*)?([\d.,]+)\s*(?:em|no|na|de|com|para|pra)?\s*(.+)?/i,
    /(?:comprei|compr[ou])\s*(.+?)\s*(?:por|de|a)\s*(?:R\$\s*)?([\d.,]+)/i,
    /(?:R\$\s*)?([\d.,]+)\s*(?:em|no|na|de|para)\s*(.+)/i,
    // "saiu X da conta" / "saída de X" / "foi debitado X"
    /(?:saiu|sa[ií]da)\s*(?:de\s*)?(?:R\$\s*)?([\d.,]+)\s*(?:da|do|de)\s*(conta\s*)?(.+)/i,
  ];
  const incomePatterns = [
    /(?:recebi|ganhei|entrou|recebeu|entrada)\s*(?:de\s*)?(?:R\$\s*)?([\d.,]+)\s*(?:de|por|para|na|no|em)?\s*(.+)?/i,
    /(?:transfer[êe]ncia|depósito|crédito)\s*(?:de\s*)?(?:R\$\s*)?([\d.,]+)\s*(?:de|por|para|na|no|em)?\s*(.+)?/i,
    /(?:R\$\s*)?([\d.,]+)\s*(?:de\s*)?(?:salário|freela|freelance|pagamento|renda|boleto)/i,
    // "caiu X na conta" / "entrou X na conta" / "depositou X"
    /(?:caiu|entrou|chegou|ca[ií]do|entrado)\s*(?:de\s*)?(?:R\$\s*)?([\d.,]+)\s*(?:na|no|em|da|do)\s*(conta\s*)?(.+)/i,
  ];
  const incomeKeywords = [
    "recebi", "ganhei", "salário", "freela", "freelance",
    "pagamento", "renda", "entrada", "depósito", "crédito", "transferência",
    "caiu", "entrou", "chegou",
  ];
  const isIncome = incomeKeywords.some((k) => text.toLowerCase().includes(k));
  const patterns = isIncome ? incomePatterns : expensePatterns;
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) {
      const amount = parseFloat(m[1].replace(",", "."));
      if (isNaN(amount) || amount <= 0) continue;
      let description = (m[2] || "").trim();
      description = description.replace(/^(hoje|ontem|agora|de|por|para|pra|no|na|em|com|a|conta)\s*/i, "").trim();
      description = description.replace(/\s*(no|do|o)\s*valor$/i, "").trim();
      if (!description) description = isIncome ? "Entrada via WhatsApp" : "Gasto via WhatsApp";
      const isGeneric = description === "Transação via WhatsApp" || description === "Gasto via WhatsApp" || description === "Entrada via WhatsApp";

      return {
        type: isIncome ? "income" : "expense",
        amount,
        description: description.charAt(0).toUpperCase() + description.slice(1),
        confidence_score: isGeneric ? 0.6 : 0.85,
        category_name: inferCategoryFromText(description),
      };
    }
  }
  return null;
}

// Mapeia palavras-chave do texto para nome de categoria conhecida.
// Cobre aliases comuns: marcas, serviços, locais.
const KEYWORD_CATEGORY_MAP: { keywords: string[]; category: string }[] = [
  { keywords: ["mercado", "supermercado", "wozniak", "jacomar", "araucária", "araucaria", "tenda", "atacadão", "atacadao", "assai", "assaí", "carrefour", "extra"], category: "Mercado" },
  { keywords: ["ifood", "rappi", "uber eats", "zé delivery", "lanche", "lanchonete"], category: "Alimentação" },
  { keywords: ["restaurante", "restaurant", "almoço", "almoco", "jantar", "café", "cafe", "padaria", "bar"], category: "Restaurante" },
  { keywords: ["uber", "99", "taxi", "táxi", "ônibus", "onibus", "metrô", "metro", "estacionamento", "combustível", "combustivel", "gasolina", "posto"], category: "Transporte" },
  { keywords: ["aluguel", "aluguer", "condomínio", "condominio", "iptu"], category: "Moradia" },
  { keywords: ["luz", "água", "agua", "energia", "internet", "celular", "vivo", "claro", "tim"], category: "Moradia" },
  { keywords: ["netflix", "spotify", "amazon prime", "disney", "hbo", "apple", "globoplay", "paramount", "streaming"], category: "Assinaturas" },
  { keywords: ["farmácia", "farmacia", "drogaria", "remédio", "remedio", "consulta", "exame"], category: "Saúde" },
  { keywords: ["curso", "livro", "udemy", "alura", "duolingo"], category: "Educação" },
  { keywords: ["cinema", "show", "balada", "parque", "lazer", "jogo"], category: "Lazer" },
  { keywords: ["salário", "salario", "pagamento"], category: "Salário" },
  { keywords: ["freela", "freelance", "freelancer"], category: "Freelance" },
];

function inferCategoryFromText(text: string): string | undefined {
  const t = text.toLowerCase();
  for (const { keywords, category } of KEYWORD_CATEGORY_MAP) {
    for (const kw of keywords) {
      if (t.includes(kw)) return category;
    }
  }
  return undefined;
}

async function parseWithGemini(text: string): Promise<ParsedTransaction | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return null;
  const prompt = `Você é um assistente que extrai transações financeiras de mensagens em português brasileiro.

Analise a mensagem e retorne APENAS um JSON válido (sem markdown) com:
{
  "type": "income" ou "expense",
  "amount": número positivo,
  "description": string curta (capitalize first letter),
  "category_name": uma de ["Alimentação","Mercado","Restaurante","Cafés","Transporte","Moradia","Saúde","Educação","Lazer","Assinaturas","Compras","Salário","Freelance","Investimentos","Outros"]
}

Regras:
- "gastei","paguei","comprei","debitou" = expense
- "recebi","ganhei","entrou","depósito" = income
- amount SEMPRE positivo
- Se não for transação, retorne: {"error": "not_a_transaction"}

Mensagem: """${text}"""`;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1, maxOutputTokens: 1500,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.error) return null;
    if (parsed.type !== "income" && parsed.type !== "expense") return null;
    const amount = Number(parsed.amount);
    if (isNaN(amount) || amount <= 0) return null;
    return {
      type: parsed.type, amount,
      description: String(parsed.description || "Transação via WhatsApp").trim(),
      confidence_score: 0.95,
      category_name: parsed.category_name || undefined,
    };
  } catch (e) {
    console.error("Gemini parse failed:", String(e));
    return null;
  }
}

// Circuit breaker simples: bloqueia Gemini por N segundos após erro
let geminiBlockedUntil = 0;

async function chatWithGemini(userMessage: string, context: string): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.error("GEMINI_API_KEY not set");
    return "🤖 _Cérebro offline no momento. Tenta de novo em 1 min._";
  }

  // Circuit breaker: se falhou recentemente, não tenta de novo
  const now = Date.now();
  if (now < geminiBlockedUntil) {
    const waitSec = Math.ceil((geminiBlockedUntil - now) / 1000);
    return `⏳ _IA em cooldown (${waitSec}s) por limite de cota. Tente de novo em instantes ou pergunte algo como "saldo" / "mês" / "dica" que eu respondo direto._`;
  }

  const system = `Você é o agente financeiro pessoal do usuário, integrado ao WhatsApp. Você é brasileiro, direto, amigável e usa linguagem informal mas técnica quando necessário. Responde SEMPRE em português do Brasil.

Você tem acesso ao contexto financeiro completo do usuário abaixo, que inclui: saldo de todas as contas, resumo do mês atual, despesas por categoria, médias históricas dos últimos 3 meses, orçamentos, metas, e transações recentes (últimos 30 dias).

${context}

## Suas Capacidades
- Responder perguntas sobre saldos, gastos, receitas, categorias, contas específicas
- Comparar meses, identificar tendências, alertar sobre gastos fora do padrão
- Calcular médias, projeções, sugerir cortes
- Lembrar do que foi gasto nos últimos dias e fazer conexões ("você gastou X em Y no dia Z")
- Identificar padrões (ex: "todo dia 5 você paga aluguel")
- Sugerir ações práticas baseadas nos dados

## Regras de Resposta (WhatsApp)
- Use markdown WhatsApp: *negrito* (1 asterisco de cada lado), _itálico_, ~riscado~, \`código\`
- Listas com • (bullet)
- Máx ~200 palavras (WhatsApp friendly)
- Valores em R$ formatados (R$ 1.234,56) — sempre com vírgula e 2 casas
- Datas em DD/MM/AAAA
- Emojis com moderação (1-3 por mensagem, sem spamm)
- Seja objetivo: vá direto ao ponto, depois adicione 1 frase de contexto/insight se relevante

## Regra de Honestidade
- Se a informação NÃO estiver no contexto, diga "não tenho essa info agora" — NÃO invente números
- Se o usuário perguntar sobre data futura ou algo que ainda não aconteceu, diga que é futuro
- Se o contexto não tiver dados suficientes para a pergunta, peça mais detalhe

## Regra de Proatividade
- Ao final de respostas de consulta, se identificar algo relevante (alerta, padrão, dica), adicione 1 linha de insight
- Ex: "_💡 Notei que você gasta 30% mais com X aos fins de semana_"
- Não force a barra — só adicione se for genuinamente útil`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: system + "\n\nUsuário: " + userMessage }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1500, thinkingConfig: { thinkingBudget: 0 } },
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (res.ok) {
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text && text.trim()) return text;
      console.error("Gemini returned empty. Full response:", JSON.stringify(json).substring(0, 500));
      return "🤔 _Pensei mas não consegui formular uma resposta. Tenta reformular?_";
    }
    const errBody = await res.text();
    console.error(`Gemini HTTP ${res.status}:`, errBody.substring(0, 300));

    // Detecta quota exceeded (429) e ativa circuit breaker por 60s
    if (res.status === 429) {
      geminiBlockedUntil = Date.now() + 60_000;
      return `⏳ _Limite de uso da IA atingido por hoje (free tier). Tente de novo em ~1 min, ou use comandos diretos:_
• *saldo* — ver saldos
• *mês* — resumo do mês
• *hoje* — transações de hoje
• *metas* — metas e orçamentos
• *total de gastos* — consulta rápida`;
    }

    // Log erro no banco
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL"),
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      );
      await supabase.from("webhook_events").insert({
        provider: "evolution_api",
        event_type: "debug_gemini_error",
        payload: { status: res.status, errBody: errBody.substring(0, 800), user_message: userMessage.substring(0, 200) } as any,
        processed: false,
        error_message: `Gemini HTTP ${res.status}`,
      });
    } catch (_) { /* swallow */ }
    return "🤖 _Tive um problema pra pensar agora. Tenta de novo em 30s?_";
  } catch (e) {
    console.error("Gemini fetch error:", String(e));
    return "🤖 _Erro de conexão com o cérebro. Tenta de novo?_";
  }
}

// ============ CONTEXT BUILDERS ============
async function buildContext(supabase: any, userId: string): Promise<string> {
  return await buildFullContext(supabase, userId);
}

// ============ FULL CONTEXT (para chat livre com Gemini) ============
// Puxa TUDO relevante do banco: contas, resumo do mês, top categorias,
// transações dos últimos 30 dias (sample), médias históricas, metas, orçamentos
async function buildFullContext(supabase: any, userId: string): Promise<string> {
  const month = startOfMonth().slice(0, 7);
  const monthDate = startOfMonth();
  const today = new Date();
  const thirtyDaysAgo = new Date(today); thirtyDaysAgo.setDate(today.getDate() - 30);
  const ninetyDaysAgo = new Date(today); ninetyDaysAgo.setDate(today.getDate() - 90);
  const thirtyDaysAgoStr = isoDate(thirtyDaysAgo);
  const ninetyDaysAgoStr = isoDate(ninetyDaysAgo);

  const [balances, summary, categorySummary, goals, budgets, recentTx, accountsList, recentCategories] = await Promise.all([
    supabase.from("view_account_balances").select("*").eq("user_id", userId),
    supabase.from("view_monthly_summary").select("*").eq("user_id", userId).eq("competence_month", monthDate).maybeSingle(),
    supabase.from("view_category_summary_month").select("*").eq("user_id", userId).eq("competence_month", monthDate).order("total_amount", { ascending: false }),
    supabase.from("monthly_goals").select("*").eq("user_id", userId).eq("month", month).maybeSingle(),
    supabase.from("category_budgets").select("*, category:categories(name, icon)").eq("user_id", userId).eq("month", month),
    supabase.from("transactions")
      .select("id, type, amount, description, transaction_date, status, account:accounts(name), category:categories(name, icon)")
      .eq("user_id", userId)
      .eq("status", "confirmed")
      .gte("transaction_date", thirtyDaysAgoStr)
      .lte("transaction_date", todayISO())
      .order("transaction_date", { ascending: false })
      .limit(60),
    supabase.from("accounts").select("id, name, type, initial_balance, active").eq("user_id", userId).eq("active", true).order("name"),
    supabase.from("transactions")
      .select("amount, category:categories(name)")
      .eq("user_id", userId)
      .eq("type", "expense")
      .eq("status", "confirmed")
      .gte("transaction_date", ninetyDaysAgoStr)
      .lte("transaction_date", todayISO()),
  ]);

  const totalBalance = (balances.data || []).reduce((s: number, a: any) => s + Number(a.current_balance || 0), 0);
  const income = Number(summary.data?.total_income || 0);
  const expense = Number(summary.data?.total_expense || 0);
  const savings = Number(goals.data?.savings_goal || 0);
  const expenseLimit = Number(goals.data?.expense_limit || 0);

  // Média histórica de despesa por categoria (90 dias)
  const catTotals: Record<string, { sum: number; count: number }> = {};
  for (const r of recentCategories.data || []) {
    const name = r.category?.name || "Outros";
    if (!catTotals[name]) catTotals[name] = { sum: 0, count: 0 };
    catTotals[name].sum += Number(r.amount);
    catTotals[name].count += 1;
  }
  const catAvg = Object.entries(catTotals)
    .map(([name, v]) => ({ name, avg: v.sum / 3, total: v.sum, count: v.count })) // 3 meses
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // Transações por dia (últimos 30)
  const txByDay: Record<string, { inc: number; exp: number; count: number }> = {};
  for (const t of recentTx.data || []) {
    const d = t.transaction_date;
    if (!txByDay[d]) txByDay[d] = { inc: 0, exp: 0, count: 0 };
    const amt = Number(t.amount);
    if (t.type === "income") txByDay[d].inc += amt; else txByDay[d].exp += amt;
    txByDay[d].count += 1;
  }
  const sortedDays = Object.entries(txByDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);

  // Saldo por conta
  const accountLines: string[] = [];
  for (const a of (balances.data || [])) {
    const name = a.account_name || a.name || "Sem nome";
    const inc = Number(a.total_income || 0);
    const exp = Number(a.total_expense || 0);
    accountLines.push(`- ${name} (${a.account_type || a.type || "conta"}): saldo ${formatBRL(Number(a.current_balance || 0))} | mês: +${formatBRL(inc)} / -${formatBRL(exp)}`);
  }

  // === Monta contexto ===
  let ctx = `# CONTEXTO FINANCEIRO COMPLETO\n`;
  ctx += `Data atual: ${formatDateBR(todayISO())} (mês ${month})\n`;
  ctx += `\n## Resumo do Mês Atual (${month})\n`;
  ctx += `- Saldo total em contas: ${formatBRL(totalBalance)}\n`;
  ctx += `- Receitas do mês: ${formatBRL(income)}\n`;
  ctx += `- Despesas do mês: ${formatBRL(expense)}\n`;
  ctx += `- Saldo do mês (receitas - despesas): ${formatBRL(income - expense)}\n`;
  if (savings > 0) ctx += `- Meta de economia: ${formatBRL(savings)}\n`;
  if (expenseLimit > 0) ctx += `- Limite de gastos: ${formatBRL(expenseLimit)} (usou ${((expense / expenseLimit) * 100).toFixed(0)}%)\n`;

  if (accountLines.length > 0) {
    ctx += `\n## Contas (saldos e movimento do mês)\n`;
    for (const l of accountLines) ctx += `${l}\n`;
  }

  if (categorySummary.data && categorySummary.data.length > 0) {
    ctx += `\n## Despesas por Categoria (mês atual)\n`;
    for (const c of categorySummary.data) {
      ctx += `- ${c.category_name || "Outros"}: ${formatBRL(Number(c.total_amount || 0))} (${c.transaction_count || 0} transações)\n`;
    }
  }

  if (catAvg.length > 0) {
    ctx += `\n## Média Histórica de Despesas por Categoria (últimos 3 meses)\n`;
    for (const c of catAvg) {
      ctx += `- ${c.name}: ${formatBRL(c.total)} total / ${formatBRL(c.avg)} por mês (${c.count} lançamentos)\n`;
    }
  }

  if (budgets.data && budgets.data.length > 0) {
    ctx += `\n## Orçamentos por Categoria (mês atual)\n`;
    for (const b of budgets.data) {
      const pct = b.limit_amount > 0 ? ((Number(b.current_amount || 0) / Number(b.limit_amount)) * 100).toFixed(0) : 0;
      const ic = b.category?.icon ? `${b.category.icon} ` : "";
      ctx += `- ${ic}${b.category?.name || "?"}: ${formatBRL(Number(b.current_amount || 0))} de ${formatBRL(Number(b.limit_amount))} (${pct}%)\n`;
    }
  }

  if (sortedDays.length > 0) {
    ctx += `\n## Últimos 7 dias com movimento (mais recente → mais antigo)\n`;
    for (const [day, v] of sortedDays) {
      ctx += `- ${formatDateBR(day)}: ${v.count} transações | receitas ${formatBRL(v.inc)} | despesas ${formatBRL(v.exp)} | líquido ${formatBRL(v.inc - v.exp)}\n`;
    }
  }

  // Top 10 transações recentes (últimos 30 dias)
  if (recentTx.data && recentTx.data.length > 0) {
    ctx += `\n## Transações Recentes (últimos 30 dias, até 15 mais relevantes)\n`;
    const top = [...recentTx.data]
      .sort((a: any, b: any) => Number(b.amount) - Number(a.amount))
      .slice(0, 15);
    for (const t of top) {
      const e = t.type === "income" ? "💰" : "💸";
      const acc = (t.account as any)?.name || "?";
      const cat = (t.category as any)?.name || "Sem categoria";
      ctx += `${e} ${formatDateBR(t.transaction_date)} | ${formatBRL(Number(t.amount))} | ${acc} | ${cat} | "${t.description}"\n`;
    }
  }

  return ctx;
}

// ============ QUERY INTENT (consultas agregadas com filtros) ============
type AggType = "income" | "expense" | "all";

interface QueryIntent {
  type: AggType;
  account: AccountRow | null;
  period: PeriodRange | null;
}

const QUERY_PATTERNS: RegExp[] = [
  // Perguntas com "total/quanto/qual/soma/resumo/resuma" + "despesas/gastos/receitas/saidas/entradas"
  /\b(total|quanto|qual|quantos?|soma|resumo|resum[oa])\b.*\b(sa[ií]das?|despesas?|gastos?|gastei|receitas?|recebi|entradas?|ganhei|transa[cç][oõ]es?)\b/i,
  // "despesas/receitas/gastos" + "de/do/da/ate/ate agora/ate o momento"
  /\b(sa[ií]das?|despesas?|gastos?|gastei|receitas?|recebi|entradas?)\b.*\b(de|do|da|nas?|nos?|at[e\u00e9]\s*(agora|o\s*momento|hoje|a\s*data)|at[e\u00e9]\b|ate\b|agora)\b/i,
  // "despesas ate agora" / "despesas ate o momento" / "gastos ate hoje"
  /\b(sa[ií]das?|despesas?|gastos?|receitas?|entradas?)\s+(at[e\u00e9]|ate)\b/i,
  // Perguntas "quanto/qual" + verbo
  /\b(quanto|qual)\s+(foi|gastei|recebi|entrou|saiu|tenho|sobrou|sobra)\b/i,
  // "me diz/me mostra/me conta" + financeiro
  /\b(me\s+d[ií]z[ae]?|me\s+mostra|me\s+conta|me\s+fala)\b.*\b(gastos?|despesas?|sa[ií]das?|receitas?|entradas?|saldo|conta)/i,
  // "minhas despesas" / "meus gastos" / "minhas receitas"
  /\b(minhas?|meus?)\s+(sa[ií]das?|despesas?|gastos?|receitas?|entradas?|contas?|transa[cç][oõ]es?)\b/i,
  // "o que eu gastei/comprei/paguei" (consulta do passado)
  /\b(o\s*que|oq)\s+(eu\s+)?(gastei|comprei|paguei|recebi|ganhei|despes[ei])\b/i,
  // "listar/liste/list" + financeiro
  /\b(list[ae]r?)\s+(gastos?|despesas?|receitas?|transa[cç][oõ]es?)/i,
  // "mostra/traz/exibe" + financeiro
  /\b(mostra|traz|exibe|exibir)\s+(os|as|meus|minhas)?\s*(gastos?|despesas?|receitas?|sa[ií]das?|entradas?|transa[cç][oõ]es?)/i,
];

// Heurística: detecta se mensagem tem valor monetário explícito (R$ X, X reais, número com vírgula, etc)
// Se tiver, é forte candidato a TRANSAÇÃO, não a consulta
function hasExplicitAmount(text: string): boolean {
  // R$ 100 / R$100 / 100 reais / 100,00 / 100.50
  if (/r\$\s*\d/i.test(text)) return true;
  if (/\d+\s*(reais|rs)\b/i.test(text)) return true;
  if (/\b\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\b/.test(text)) return true; // 1.234,56 ou 1234,56
  return false;
}

// Detecta comandos de ajuste manual: "zere o contexto", "some X", "tira X", "adicione X ao saldo"
const ADJUSTMENT_PATTERNS: RegExp[] = [
  /\b(zer[ae]\s*(o\s*)?(contexto|saldo|conta))/i,
  /\b(some|tira|adiciona|subtrai|acrescenta|remove|debita|credita)\s+(r\$\s*)?\d/i,
  /\b(ajust[ae]r?)\s+(o\s*)?(saldo|conta)/i,
  /\b(retom[ae]r?)\s+(os?\s*)?\d/i,
  /\b(corrig[ae]r?)\s+(o\s*)?(saldo|conta|valor)/i,
];

function isAdjustmentCommand(text: string): boolean {
  for (const p of ADJUSTMENT_PATTERNS) if (p.test(text)) return true;
  return false;
}

// Detecta comandos de DEFINIÇÃO DIRETA do saldo da conta: "mude o saldo do X para Y", "altere saldo X pra Y", "defina o saldo de X como Y", "recalcule o saldo do X"
const BALANCE_SET_PATTERNS: RegExp[] = [
  // Definir/alterar saldo
  /\b(mud[ae]?|alter[ae]|defin[ae]|coloqu[ae]|deix[ae]|ajust[ae]?)\s+(o\s*)?(saldo|valor)\b/i,
  /\b(o\s*)?(saldo|valor)\s+(da\s+|do\s+|de\s+)/i,
  /\b(saldo|valor)\s+(ficar|ser|fica)\b/i,
  /\b(quero\s+que\s+o\s+saldo)/i,
  // Recalcular / voltar a calcular / limpar override
  /\b(recalcul[ae]|volte?\s+a\s+calcular|c[áa]lcul[ae]\s+automaticamente|volt[ae]\s+automaticamente)\b/i,
  /\b(limpe?|remov[ae]|tir[ae])\s+(o\s*)?(override|ajuste\s+manual|ajuste)/i,
];

function isBalanceSetCommand(text: string): boolean {
  for (const p of BALANCE_SET_PATTERNS) if (p.test(text)) return true;
  return false;
}

async function handleBalanceSet(supabase: any, userId: string, text: string): Promise<string> {
  // Se a intent é RECALCULAR (não tem valor monetário no texto), limpa override
  const isRecalcIntent = /\b(recalcul[ae]|volte?\s+a\s+calcular|c[áa]lcul[ae]\s+automaticamente|volt[ae]\s+automaticamente|limpe?\s+(o\s*)?(override|ajuste)|remov[ae]\s+(o\s*)?(override|ajuste\s+manual|ajuste)|tir[ae]\s+(o\s*)?(override|ajuste))\b/i.test(text);
  const hasNumber = /\d/.test(text);

  if (isRecalcIntent || !hasNumber) {
    return await clearAccountBalance(supabase, userId, text);
  }

  // Extrai o valor alvo (R$ X, X reais, número com vírgula/ponto)
  const valueMatch = text.match(/(?:r\$\s*)?(\d{1,3}(?:[.,]\d{3})*[.,]?\d{0,2})\s*(reais|rs)?/i);
  if (!valueMatch) {
    return "🤔 _Não identifiquei o valor. Tenta algo como:_\n• *mude o saldo do Inter para 500*\n• *defina o saldo da Nubank como R$ 1.200*\n• *altere saldo Inter pra 750*";
  }
  let raw = valueMatch[1].replace(/\./g, "").replace(",", ".");
  const newBalance = Math.abs(Number(raw));
  if (isNaN(newBalance) || newBalance < 0) {
    return "❌ _Valor inválido._";
  }

  // Tenta resolver a conta pelo nome mencionado
  const account = await resolveAccount(supabase, userId, text);
  if (!account) {
    return "❌ _Não encontrei a conta. Menciona o nome:_\n• *mude o saldo do Inter para 500*\n• *defina saldo Nubank como R$ 1000*";
  }

  // Pega saldo atual (calculado) pra mostrar comparação
  const { data: balance } = await supabase
    .from("view_account_balances")
    .select("current_balance, calculated_balance, has_override")
    .eq("account_id", account.id)
    .eq("user_id", userId)
    .maybeSingle();
  const previousBalance = balance ? Number(balance.current_balance ?? balance.calculated_balance ?? 0) : 0;

  // Define o override (update direto — service_role bypassa RLS)
  const { error } = await supabase
    .from("accounts")
    .update({
      current_balance_override: newBalance,
      balance_override_at: new Date().toISOString(),
      balance_override_note: `Ajustado via WhatsApp (era ${formatBRL(previousBalance)})`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id)
    .eq("user_id", userId);
  if (error) return `❌ _Erro ao atualizar saldo: ${error.message}_`;

  const diff = newBalance - previousBalance;
  const diffTxt = diff === 0 ? "sem alteração" : (diff > 0 ? `+${formatBRL(diff)}` : formatBRL(diff));

  return [
    `✅ *Saldo atualizado!*\n\n`,
    `💳 *${account.name}*`,
    `💰 *Novo saldo: ${formatBRL(newBalance)}*`,
    `📊 Anterior (calculado): ${formatBRL(previousBalance)} _(diferença: ${diffTxt})_`,
    ``,
    `⚠️ _O saldo agora é fixo. Para voltar ao cálculo automático, é só dizer: "recalcule o saldo do ${account.name}"_`,
  ].join("\n");
}

async function clearAccountBalance(supabase: any, userId: string, text: string): Promise<string> {
  const account = await resolveAccount(supabase, userId, text);
  if (!account) {
    // Sem conta mencionada: limpa todas
    const { data: accs } = await supabase.from("accounts").select("id, name").eq("user_id", userId).eq("active", true);
    if (!accs || accs.length === 0) return "❌ _Nenhuma conta ativa encontrada._";
    for (const a of accs) {
      await supabase.from("accounts").update({
        current_balance_override: null,
        balance_override_at: null,
        balance_override_note: null,
        updated_at: new Date().toISOString(),
      }).eq("id", a.id).eq("user_id", userId);
    }
    return `🔄 *Override removido de todas as ${accs.length} conta(s).* Saldos agora seguem o cálculo automático.`;
  }

  const { error } = await supabase.from("accounts").update({
    current_balance_override: null,
    balance_override_at: null,
    balance_override_note: null,
    updated_at: new Date().toISOString(),
  }).eq("id", account.id).eq("user_id", userId);
  if (error) return `❌ _Erro: ${error.message}_`;
  return `🔄 *Override removido de ${account.name}.* Saldo agora é calculado automaticamente.`;
}

// Mensagens de ajuste manual precisam ser tratadas com cautela — registrar como "Ajuste manual" pelo valor
async function handleManualAdjustment(supabase: any, userId: string, text: string): Promise<string> {
  // Extrai valor
  const m = text.match(/(\d+(?:[.,]\d{3})*[.,]?\d*)/);
  if (!m) return "🤔 _Não consegui identificar o valor. Tenta algo como:_\n• *some 30 no saldo*\n• *ajustar saldo em -50*\n• *zere a conta inter*";
  const amount = Math.abs(Number(m[1].replace(/\./g, "").replace(",", ".")));
  if (isNaN(amount) || amount <= 0) return "❌ _Valor inválido._";

  // Detecta se é soma (+) ou subtração (-)
  const isSubtract = /\b(tira|subtrai|remove|debita|zera)/i.test(text) || /^-|negativo/i.test(text.trim());
  // Caso especial "zere o contexto e retome os 30" — leio o segundo número
  let finalAmount = amount;
  if (/zer[ae]/i.test(text)) {
    const allNumbers = text.match(/\d+(?:[.,]\d{2})?/g);
    if (allNumbers && allNumbers.length >= 2) {
      finalAmount = Math.abs(Number(allNumbers[1].replace(",", ".")));
    }
    // "zere e retome os X" = zera conta e adiciona X como despesa
    if (/retom[ae]|adicione|some/i.test(text)) {
      return await registerAdjustment(supabase, userId, finalAmount, "expense", "Ajuste manual (zerar e retomar)");
    }
    return "🧹 _Para zerar uma conta, abre o app em *Contas* e edita o saldo inicial. Não consigo zerar diretamente pelo WhatsApp pra não perder histórico._";
  }

  return await registerAdjustment(supabase, userId, finalAmount, isSubtract ? "expense" : "income", `Ajuste manual: ${isSubtract ? "-" : "+"}${finalAmount.toFixed(2)}`);
}

async function registerAdjustment(supabase: any, userId: string, amount: number, type: "income" | "expense", description: string): Promise<string> {
  // Pega a primeira conta ativa do usuário
  const { data: acc } = await supabase.from("accounts").select("id, name").eq("user_id", userId).eq("active", true).order("name").limit(1).maybeSingle();
  if (!acc) return "❌ _Você não tem conta ativa cadastrada._";

  const { data: txId, error } = await supabase.rpc("ingest_transaction_from_agent", {
    payload: {
      user_id: userId,
      type,
      amount,
      description,
      source: "whatsapp",
      status: "confirmed",
      confidence_score: 0.9,
      transaction_date: todayISO(),
      provider: "evolution_api",
      account_id: acc.id,
    } as any,
  });
  if (error) return `❌ _Erro ao registrar ajuste: ${error.message}_`;
  return `✅ *Ajuste registrado!*\n\n${type === "income" ? "💰" : "💸"} *R$ ${amount.toFixed(2).replace(".", ",")}* — ${description}\n💳 ${acc.name}\n\n⚠️ _Lembrando que isso é um ajuste manual — para zerar contas de verdade, edite o saldo inicial no app._`;
}

function isQueryIntent(text: string): boolean {
  for (const p of QUERY_PATTERNS) if (p.test(text)) return true;
  return false;
}

function extractQueryType(text: string): AggType {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // income keywords
  if (/(receita|recebi|recebeu|entrada|entrou|ganhei|ganho|renda|salario|salario)/.test(t)) return "income";
  // expense keywords
  if (/(sa[ií]da|sa[ií]do|despesa|gasto|gastei|gastos|paguei|comprei|debito|debitei)/.test(t)) return "expense";
  return "all";
}

async function handleQuery(supabase: any, userId: string, text: string): Promise<string> {
  const type = extractQueryType(text);
  const period = parsePeriod(text);
  const account = await resolveAccount(supabase, userId, text);

  // Fallback: se não identificou período, usa o mês atual ATÉ HOJE
  const range: PeriodRange = period ?? {
    start: startOfMonth(),
    end: todayISO(),
    label: startOfMonth().slice(0, 7),
  };

  // Monta query
  let q = supabase
    .from("transactions")
    .select("type, amount, description, transaction_date, status, account:accounts(name), category:categories(name, icon)")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .gte("transaction_date", range.start)
    .lte("transaction_date", range.end);
  if (type !== "all") q = q.eq("type", type);
  if (account) q = q.eq("account_id", account.id);
  q = q.order("transaction_date", { ascending: false }).limit(500);

  const { data, error } = await q;
  if (error) return `❌ Erro ao consultar: ${error.message}`;
  if (!data || data.length === 0) {
    // Concordância: "nenhuma despesa" (sing), "nenhuma receita" (sing), "nenhuma transação" (sing)
    const tipoSing = type === "income" ? "receita" : type === "expense" ? "despesa" : "transação";
    const contaLabel = account ? ` em *${account.name}*` : "";
    return `📭 Nenhuma ${tipoSing} encontrada${contaLabel} em *${range.label}*.`;
  }

  let total = 0;
  let count = data.length;
  const byDay: Record<string, { inc: number; exp: number }> = {};
  for (const t of data) {
    const amt = Number(t.amount);
    if (t.type === "income") total += amt; else total -= amt;
    const day = t.transaction_date;
    if (!byDay[day]) byDay[day] = { inc: 0, exp: 0 };
    if (t.type === "income") byDay[day].inc += amt; else byDay[day].exp += amt;
  }

  // Labels
  const tipoLabel = type === "income" ? "Receitas" : type === "expense" ? "Despesas" : "Movimentações";
  const tipoEmoji = type === "income" ? "💰" : type === "expense" ? "💸" : "📊";
  const contaLabel = account ? ` em *${account.name}*` : "";

  const lines: string[] = [
    `${tipoEmoji} *${tipoLabel}${contaLabel} — ${range.label}*`,
    ``,
    `${tipoEmoji} *Total: ${formatBRL(Math.abs(total))}*`,
    `📈 ${count} transação(ões) confirmada(s)`,
  ];

  // Breakdown por dia (top 5 dias com mais movimento)
  const dayEntries = Object.entries(byDay)
    .map(([day, v]) => ({ day, total: v.exp + v.inc, exp: v.exp, inc: v.inc }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  if (dayEntries.length > 0) {
    lines.push(``, `*Por dia (top 5):*`);
    for (const d of dayEntries) {
      const txt = type === "income" ? `+${formatBRL(d.inc)}`
        : type === "expense" ? `-${formatBRL(d.exp)}`
        : `${d.inc > 0 ? "+" : ""}${formatBRL(d.inc)} / -${formatBRL(d.exp)}`;
      lines.push(`• ${formatDateBR(d.day)}: ${txt}`);
    }
  }

  // Top 3 maiores
  const sorted = [...data].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 3);
  if (sorted.length > 0) {
    lines.push(``, `*Maiores:*`);
    for (const t of sorted) {
      const e = t.type === "income" ? "💰" : "💸";
      const cat = t.category?.icon ? `${t.category.icon} ` : "";
      lines.push(`${e} ${formatBRL(Number(t.amount))} — ${cat}${t.description}`);
    }
  }

  return lines.join("\n");
}

// ============ COMMAND HANDLERS ============
async function cmdBalance(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from("view_account_balances").select("*").eq("user_id", userId);
  if (!data || data.length === 0) {
    return "Você ainda não tem contas cadastradas. Crie uma em *Contas* no app.";
  }
  const total = data.reduce((s: number, a: any) => s + Number(a.current_balance || 0), 0);
  const lines = [`💰 *Saldo total: ${formatBRL(total)}*`, ``, `Por conta:`];
  for (const a of data) {
    const name = a.account_name || a.name || "Sem nome";
    const type = a.account_type || a.type || "conta";
    const balance = Number(a.current_balance ?? a.balance ?? 0);
    const calculated = Number(a.calculated_balance ?? balance);
    const hasOverride = !!a.has_override;
    const marker = hasOverride ? " 🔧" : "";
    const diff = hasOverride && calculated !== balance ? ` _(calculado: ${formatBRL(calculated)})_` : "";
    lines.push(`• ${name} (${type})${marker}: ${formatBRL(balance)}${diff}`);
  }
  lines.push(``, `_🔧 = saldo ajustado manualmente_`);
  return lines.join("\n");
}

async function cmdToday(supabase: any, userId: string): Promise<string> {
  const today = todayISO();
  const { data } = await supabase
    .from("transactions")
    .select("type, amount, description, category:categories(name, icon)")
    .eq("user_id", userId)
    .eq("transaction_date", today)
    .order("created_at", { ascending: false });
  if (!data || data.length === 0) {
    return "📅 Nenhuma transação registrada hoje ainda.";
  }
  let inc = 0, exp = 0;
  const lines = [`📅 *Transações de hoje*`, ``];
  for (const t of data) {
    const amt = Number(t.amount);
    if (t.type === "income") inc += amt; else exp += amt;
    const emoji = t.type === "income" ? "💰" : "💸";
    const cat = t.category?.icon ? `${t.category.icon} ` : "";
    lines.push(`${emoji} ${formatBRL(amt)} — ${cat}${t.description}`);
  }
  lines.push(``, `Receitas: ${formatBRL(inc)}`);
  lines.push(`Despesas: ${formatBRL(exp)}`);
  lines.push(`*Saldo do dia: ${formatBRL(inc - exp)}*`);
  return lines.join("\n");
}

async function cmdMonth(supabase: any, userId: string): Promise<string> {
  const month = startOfMonth().slice(0, 7);
  const monthDate = startOfMonth();
  const { data: summary } = await supabase
    .from("view_monthly_summary")
    .select("*")
    .eq("user_id", userId)
    .eq("competence_month", monthDate)
    .maybeSingle();
  const { data: cats } = await supabase
    .from("view_category_summary_month")
    .select("*")
    .eq("user_id", userId)
    .eq("competence_month", monthDate)
    .order("total_amount", { ascending: false });

  const inc = Number(summary?.total_income || 0);
  const exp = Number(summary?.total_expense || 0);
  const lines = [
    `📊 *Resumo do mês ${month}*`,
    ``,
    `💰 Receitas: ${formatBRL(inc)}`,
    `💸 Despesas: ${formatBRL(exp)}`,
    `*Saldo: ${formatBRL(inc - exp)}*`,
  ];
  if (cats && cats.length > 0) {
    lines.push(``, `*Top categorias:*`);
    for (const c of cats.slice(0, 5)) {
      lines.push(`• ${c.category_name || "Outros"}: ${formatBRL(c.total_amount || 0)}`);
    }
  }
  return lines.join("\n");
}

async function cmdGoals(supabase: any, userId: string): Promise<string> {
  const month = startOfMonth().slice(0, 7);
  const { data: goal } = await supabase
    .from("monthly_goals")
    .select("*")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  const { data: budgets } = await supabase
    .from("category_budgets")
    .select("*, category:categories(name, icon)")
    .eq("user_id", userId)
    .eq("month", month);

  if (!goal && (!budgets || budgets.length === 0)) {
    return "🎯 Você não tem metas ou orçamentos definidos para este mês. Crie em *Metas* no app.";
  }

  const lines = [`🎯 *Metas e Orçamentos (${month})*`, ``];
  if (goal) {
    if (goal.savings_goal) {
      const pct = goal.savings_goal > 0 ? Math.min(100, ((goal.current_amount || 0) / goal.savings_goal) * 100).toFixed(0) : 0;
      lines.push(`💰 *Economia:* ${formatBRL(goal.current_amount || 0)} / ${formatBRL(goal.savings_goal)} (${pct}%)`);
    }
    if (goal.expense_limit) {
      const pct = goal.expense_limit > 0 ? Math.min(100, ((goal.current_amount || 0) / goal.expense_limit) * 100).toFixed(0) : 0;
      const emoji = Number(pct) >= 80 ? "⚠️" : "📊";
      lines.push(`${emoji} *Limite de gastos:* ${formatBRL(goal.current_amount || 0)} / ${formatBRL(goal.expense_limit)} (${pct}%)`);
    }
  }
  if (budgets && budgets.length > 0) {
    lines.push(``, `*Por categoria:*`);
    for (const b of budgets) {
      const pct = b.limit_amount > 0 ? Math.min(100, ((b.current_amount || 0) / b.limit_amount) * 100).toFixed(0) : 0;
      const emoji = Number(pct) >= 80 ? "⚠️" : "✅";
      const ic = b.category?.icon || "";
      lines.push(`${emoji} ${ic} ${b.category?.name || "?"}: ${formatBRL(b.current_amount || 0)} / ${formatBRL(b.limit_amount)} (${pct}%)`);
    }
  }
  return lines.join("\n");
}

// ============ PROACTIVE INSIGHT ============
async function proactiveInsight(supabase: any, userId: string, categoryName: string | undefined, amount: number): Promise<string | null> {
  if (!categoryName) return null;
  // Busca média histórica da mesma categoria (últimos 3 meses)
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const sinceDate = threeMonthsAgo.toISOString().split("T")[0];

  const { data: category } = await supabase
    .from("categories")
    .select("id")
    .eq("user_id", userId)
    .ilike("name", categoryName)
    .maybeSingle();
  if (!category) return null;

  const { data: recent } = await supabase
    .from("transactions")
    .select("amount")
    .eq("user_id", userId)
    .eq("category_id", category.id)
    .eq("type", "expense")
    .gte("transaction_date", sinceDate)
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (!recent || recent.length < 3) return null;

  const avg = recent.reduce((s, t) => s + Number(t.amount), 0) / recent.length;
  if (amount > avg * 2) {
    return `💡 _Heads up: essa compra (${formatBRL(amount)}) tá 2x maior que sua média em ${categoryName} (${formatBRL(avg)})._`;
  }
  return null;
}

async function checkGoalAlerts(supabase: any, userId: string): Promise<string | null> {
  const month = startOfMonth().slice(0, 7);
  const { data: goal } = await supabase
    .from("monthly_goals")
    .select("*")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  if (!goal?.expense_limit) return null;
  const pct = (goal.current_amount / goal.expense_limit) * 100;
  if (pct >= 80 && pct < 100) {
    return `⚠️ _Você já usou ${pct.toFixed(0)}% do seu limite mensal (${formatBRL(goal.current_amount)} de ${formatBRL(goal.expense_limit)})._`;
  }
  if (pct >= 100) {
    return `🚨 _Limite mensal estourado: ${formatBRL(goal.current_amount)} de ${formatBRL(goal.expense_limit)}._`;
  }
  return null;
}

// ============ REPLY BUILDERS ============
function buildSuccessReply(t: any): string {
  const emoji = TYPE_EMOJI[t.type as "income" | "expense"];
  const label = TYPE_LABEL[t.type as "income" | "expense"];
  const categoryLine = t.category
    ? `\n📂 *${t.category.icon ? t.category.icon + " " : ""}${t.category.name}*`
    : "";
  const accountLine = t.account
    ? `\n💳 *${t.account.name}*`
    : "";
  const statusLine = t.status === "pending_review" ? `\n\n⚠️ _Confirme na aba Transações_` : "";
  return [
    `✅ *${label} registrada!*`,
    ``,
    `${emoji} *${formatBRL(Number(t.amount))}* — *${t.description}*`,
    `📅 ${formatDateBR(t.transaction_date)}${categoryLine}${accountLine}${statusLine}`,
  ].join("\n");
}

function buildParseFailedReply(text: string): string {
  return [
    `❌ *Não entendi essa mensagem*`,
    ``,
    `Você mandou: "${text}"`,
    ``,
    `💡 *Exemplos que eu entendo:*`,
    `• "gastei 50 no almoço" → registra despesa`,
    `• "recebi 5000 de salário" → registra receita`,
    `• "saldo" → mostra saldo total`,
    `• "hoje" → transações de hoje`,
    `• "mês" → resumo do mês`,
    `• "metas" → progresso das metas`,
    `• "dica" → pede uma dica financeira`,
    ``,
    `Ou só converse comigo! Pergunte qualquer coisa sobre suas finanças.`,
  ].join("\n");
}

function buildNoUserReply(phone: string): string {
  return `⚠️ *Número não cadastrado*\n\nEste número (${phone}) ainda não está vinculado a nenhuma conta.\n\nAcesse *Configurações* no app e cadastre seu WhatsApp.`;
}

// ============ WHATSAPP SENDER ============
async function sendWhatsAppReply(remoteJid: string, text: string): Promise<boolean> {
  const baseUrl = Deno.env.get("EVOLUTION_API_URL");
  const apiKey = Deno.env.get("EVOLUTION_API_KEY");
  const instance = Deno.env.get("EVOLUTION_INSTANCE");
  if (!baseUrl || !apiKey || !instance) {
    console.log("Evolution not configured — would send:", text);
    return false;
  }
  const url = `${baseUrl.replace(/\/$/, "")}/message/sendText/${instance}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ number: remoteJid, text }),
    });
    if (!res.ok) {
      console.error("Evolution sendText failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("Evolution sendText error:", String(e));
    return false;
  }
}

// Envia indicador "digitando..." (presence=composing) para o WhatsApp
// Não bloqueia o fluxo — fire and forget
function sendTyping(remoteJid: string, delayMs: number = 3000): void {
  const baseUrl = Deno.env.get("EVOLUTION_API_URL");
  const apiKey = Deno.env.get("EVOLUTION_API_KEY");
  const instance = Deno.env.get("EVOLUTION_INSTANCE");
  if (!baseUrl || !apiKey || !instance) return;
  const url = `${baseUrl.replace(/\/$/, "")}/chat/sendPresence/${instance}`;
  // O "number" pode ser o remoteJid completo ou só o número; usamos só os dígitos
  const number = remoteJid.includes("@") ? remoteJid.split("@")[0] : remoteJid;
  // Formato PLANO (não usar wrapper "options") — confirmado em teste manual
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ number, presence: "composing", delay: delayMs }),
  }).then((res) => {
    if (!res.ok) console.error("sendPresence failed:", res.status, res.statusText);
  }).catch((e) => {
    console.error("sendPresence error:", String(e));
  });
}

// ============ INTENT DETECTION ============
const COMMANDS: Record<string, (supabase: any, userId: string) => Promise<string>> = {
  saldo: cmdBalance,
  balanço: cmdBalance,
  "saldo total": cmdBalance,
  hoje: cmdToday,
  "gastos de hoje": cmdToday,
  mês: cmdMonth,
  mes: cmdMonth,
  resumo: cmdMonth,
  metas: cmdGoals,
  objetivo: cmdGoals,
  objetivos: cmdGoals,
};

async function detectCommand(text: string): Promise<((supabase: any, userId: string) => Promise<string>) | null> {
  const normalized = text.toLowerCase().trim().replace(/[!?.,]/g, "");
  // Se o usuário adicionou filtros (conta/período) após o comando, deixa o handleQuery tratar
  // Ex: "saldo nubank" → handleQuery (não cmdBalance genérico)
  const hasFilter = /\b(nubank|itau|ita[uú]|inter|santander|bradesco|carteira|carteiro|poupan[cç]a|investimento|cc|cdb|carteira|hoje|ontem|semana|m[eê]s|ano|dia|janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|2024|2025|2026|2027)\b/i.test(normalized);
  for (const key of Object.keys(COMMANDS)) {
    if (normalized === key) return COMMANDS[key];
    if (normalized.startsWith(key + " ") && !hasFilter) return COMMANDS[key];
  }
  return null;
}

// ============ AGENT COMMANDS (CRUD) ============
// Cada comando é uma ação que o usuário pode pedir ao agente.
// Ex: "cria categoria X", "remove meta Y", "lista transações da semana", etc.

// ===== CATEGORIA =====
function isCategoryCommand(text: string): { action: string; params: Record<string, any> } | null {
  const t = text.trim();
  const lc = t.toLowerCase();
  const norm = lc.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // CREATE: "cria categoria X do tipo despesa"
  let m = norm.match(/^(?:cri[ae]|adicion[ae]|nov[ao])\s+categori[ae]\s+(.+?)(?:\s+(?:do\s+tipo|tipo|com\s+a?\s*cor)\s+(despesa|receita|expense|income)(?:\s+(?:com\s+(?:a\s+)?cor|cor)\s+(#[0-9a-fA-F]{3,8}|\w+))?)?\s*$/i);
  if (m) {
    const name = m[1].trim().replace(/^(?:do\s+tipo|tipo|com\s+(?:a\s+)?cor|cor)\s+\S+\s*/i, "").trim();
    const typeRaw = (m[2] || "despesa").toLowerCase();
    const type = (typeRaw === "receita" || typeRaw === "income") ? "income" : "expense";
    const colorMatch = t.match(/(?:cor\s+)((?:#[0-9a-fA-F]{3,8})|azul|vermelho|verde|amarelo|roxo|rosa|laranja|cinza|preto|branco)/i);
    let color: string | undefined;
    if (colorMatch) {
      const c = colorMatch[1].toLowerCase();
      const colorMap: Record<string, string> = {
        azul: "#3b82f6", vermelho: "#ef4444", verde: "#10b981", amarelo: "#f59e0b",
        roxo: "#8b5cf6", rosa: "#ec4899", laranja: "#f97316", cinza: "#71717a",
        preto: "#000000", branco: "#ffffff",
      };
      color = c.startsWith("#") ? c : colorMap[c];
    }
    return { action: "create", params: { name, type, color } };
  }

  // LIST
  if (/^(?:lista|mostra|quais|ver|minhas|meus?)\s+(?:as\s+)?categori[ae]s?\s*$/i.test(norm) || /^(?:minhas\s+)?categori[ae]s?$/i.test(norm)) {
    return { action: "list", params: {} };
  }

  // DELETE
  m = norm.match(/^(?:remove|apaga|deleta|exclui|elimina)\s+categori[ae]\s+(.+)$/i);
  if (m) {
    return { action: "delete", params: { name: m[1].trim() } };
  }

  // UPDATE (rename)
  m = norm.match(/^(?:renomei[ae]|muda\s+o?\s*nome\s+d[aeo]?)\s+categori[ae]\s+(.+?)\s+(?:para|pro|pra)\s+(.+)$/i);
  if (m) {
    return { action: "update", params: { name: m[1].trim(), new_name: m[2].trim() } };
  }
  // recolor
  m = norm.match(/^(?:muda|altera|troca)\s+(?:a\s+)?cor\s+d[aeo]?\s+categori[ae]\s+(.+?)\s+(?:para|pro|pra)\s+(#[0-9a-fA-F]{3,8}|\w+)$/i);
  if (m) {
    let color = m[2].trim();
    if (!color.startsWith("#")) {
      const colorMap: Record<string, string> = {
        azul: "#3b82f6", vermelho: "#ef4444", verde: "#10b981", amarelo: "#f59e0b",
        roxo: "#8b5cf6", rosa: "#ec4899", laranja: "#f97316", cinza: "#71717a",
      };
      color = colorMap[color.toLowerCase()] || color;
    }
    return { action: "update", params: { name: m[1].trim(), color } };
  }
  // add tag
  m = norm.match(/^(?:adicion[ae]|coloca)\s+(?:a\s+)?tag\s+(.+?)\s+(?:em|no|na)\s+categori[ae]\s+(.+)$/i);
  if (m) {
    return { action: "add_tag", params: { name: m[2].trim(), tag: m[1].trim() } };
  }

  return null;
}

async function handleCategoryCommand(supabase: any, userId: string, parsed: { action: string; params: Record<string, any> }): Promise<string> {
  try {
    if (parsed.action === "list") {
      const r = await (supabase.rpc as any)("agent_category_op", { payload: { action: "list" } });
      const data = r as any;
      if (!data?.ok) return `❌ ${data?.error || "erro"}`;
      const cats: any[] = data.categories || [];
      if (cats.length === 0) return "📂 Nenhuma categoria cadastrada.";
      const lines: string[] = [`📂 *${cats.length} categorias*`, ``];
      for (const c of cats) {
        const tags = c.tags && c.tags.length > 0 ? ` [${c.tags.join(", ")}]` : "";
        lines.push(`• ${c.name} (${c.type === "expense" ? "Despesa" : "Receita"})${tags}`);
      }
      return lines.join("\n");
    }

    // Para add_tag, primeiro busca a tag atual e adiciona
    let params = { ...parsed.params };
    if (parsed.action === "add_tag") {
      const cur = await (supabase.rpc as any)("agent_category_op", { payload: { action: "list" } });
      const found = (cur as any)?.categories?.find((c: any) => c.name.toLowerCase() === parsed.params.name.toLowerCase());
      if (!found) return `❌ Categoria "${parsed.params.name}" não encontrada.`;
      const newTags = Array.from(new Set([...(found.tags || []), parsed.params.tag.toLowerCase()]));
      params = { name: parsed.params.name, tags: newTags };
    }

    const r = await (supabase.rpc as any)("agent_category_op", {
      payload: { action: parsed.action === "add_tag" ? "update" : parsed.action, ...params },
    });
    const data = r as any;
    if (!data?.ok) return `❌ ${data?.error || "erro"}`;

    switch (data.action) {
      case "create":
        return `✅ Categoria *${data.name}* criada!`;
      case "update":
        return `✅ Categoria *${data.name}* atualizada!`;
      case "delete": {
        const unlinked = data.unlinked_transactions || 0;
        return unlinked > 0
          ? `✅ Categoria *${data.name}* removida. ⚠️ ${unlinked} transação(ões) desvinculada(s).`
          : `✅ Categoria *${data.name}* removida.`;
      }
      default:
        return `✅ Operação concluída.`;
    }
  } catch (e) {
    return `❌ Erro: ${String(e)}`;
  }
}

// ===== META =====
function isGoalCommand(text: string): { action: string; params: Record<string, any> } | null {
  const t = text.trim();
  const lc = t.toLowerCase();
  const norm = lc.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const money = (s: string) => {
    const m = s.match(/r?\$?\s*([\d.,]+)/i);
    return m ? parseFloat(m[1].replace(/\./g, "").replace(",", ".")) : null;
  };

  // CREATE: "cria meta de 5000 para ferias"
  let m = norm.match(/^(?:cri[ae]|nov[ao])\s+meta\s+(?:de\s+)?([\d.,]+)\s+(?:para|pro|pra|chamad[aeo]?)\s+(.+?)(?:\s+ate\s+(.+?))?\s*$/i);
  if (m) {
    const target = money(m[1]);
    const name = m[2].trim();
    const deadline = m[3] ? parseDateBR(m[3]) : null;
    return { action: "create", params: { name, target_amount: target, deadline } };
  }
  // "cria meta viagem de 5000"
  m = norm.match(/^(?:cri[ae]|nov[ao])\s+meta\s+(.+?)\s+(?:de|com\s+(?:meta|valor|objetivo)\s+de)\s+([\d.,]+)(?:\s+ate\s+(.+?))?\s*$/i);
  if (m) {
    const target = money(m[2]);
    const name = m[1].trim();
    const deadline = m[3] ? parseDateBR(m[3]) : null;
    return { action: "create", params: { name, target_amount: target, deadline } };
  }

  // LIST
  if (/^(?:lista|mostra|quais|ver|minhas|meus?)\s+(?:as\s+)?metas\s*$/i.test(norm) || /^metas?$/i.test(norm)) {
    return { action: "list", params: {} };
  }

  // ADD AMOUNT: "adicionei 500 na meta viagem"
  m = norm.match(/^(?:adicion[ae]i|adicione|som[ae]|deposit[ae]i|pus|coloc[ae]i)\s+([\d.,]+)\s+(?:na|no|em|pra)\s+meta\s+(.+)$/i);
  if (m) {
    return { action: "add_amount", params: { name: m[2].trim(), amount: money(m[1]) } };
  }
  m = norm.match(/^meta\s+(.+?)\s*\+\s*([\d.,]+)$/i);
  if (m) {
    return { action: "add_amount", params: { name: m[1].trim(), amount: money(m[2]) } };
  }

  // DELETE
  m = norm.match(/^(?:remove|apaga|deleta|exclui|elimina)\s+(?:a\s+)?meta\s+(.+)$/i);
  if (m) {
    return { action: "delete", params: { name: m[1].trim() } };
  }

  return null;
}

function parseDateBR(s: string): string | null {
  s = s.trim().toLowerCase();
  // "dez/2026" ou "dezembro/2026"
  const monthMap: Record<string, string> = {
    jan: "01", janeiro: "01", fev: "02", fevereiro: "02", mar: "03", março: "03", marco: "03",
    abr: "04", abril: "04", mai: "05", maio: "05", jun: "06", junho: "06",
    jul: "07", julho: "07", ago: "08", agosto: "08",
    set: "09", setembro: "09", out: "10", outubro: "10",
    nov: "11", novembro: "11", dez: "12", dezembro: "12",
  };
  const m1 = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[2]}-${m1[1].padStart(2, "0")}-01`;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  const m3 = s.match(/^(\w+)\/(\d{4})$/);
  if (m3) {
    const month = monthMap[m3[1].toLowerCase()];
    if (month) return `${m3[2]}-${month}-01`;
  }
  const m4 = s.match(/^(\w+)\s+de\s+(\d{4})$/);
  if (m4) {
    const month = monthMap[m4[1].toLowerCase()];
    if (month) return `${m4[2]}-${month}-01`;
  }
  return null;
}

function parseMoneyBR(s: string): number | null {
  if (!s) return null;
  // "R$ 1.234,56" / "1.234,56" / "1,234.56" / "1234.56" / "1234,56" / "50"
  const clean = s.replace(/[r$\s]/gi, "").trim();
  if (!clean) return null;
  const hasComma = clean.includes(",");
  const hasDot = clean.includes(".");
  let normalized: string;
  if (hasComma && hasDot) {
    // "1.234,56" (BR) ou "1,234.56" (US)
    if (clean.lastIndexOf(",") > clean.lastIndexOf(".")) {
      normalized = clean.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = clean.replace(/,/g, "");
    }
  } else if (hasComma) {
    // "1234,56" → "1234.56"
    normalized = clean.replace(",", ".");
  } else {
    normalized = clean;
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

async function handleGoalCommand(supabase: any, userId: string, parsed: { action: string; params: Record<string, any> }): Promise<string> {
  try {
    if (parsed.action === "list") {
      const r = await (supabase.rpc as any)("agent_goal_op", { payload: { action: "list", user_id: userId } });
      const data = r as any;
      if (!data?.ok) return `❌ ${data?.error || "erro"}`;
      const goals: any[] = data.goals || [];
      if (goals.length === 0) return "🎯 Nenhuma meta cadastrada.";
      const lines: string[] = [`🎯 *${goals.length} meta(s)*`, ``];
      for (const g of goals) {
        const pct = g.target_amount > 0 ? Math.round((g.current_amount / g.target_amount) * 100) : 0;
        const bar = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));
        const dl = g.deadline ? ` · até ${formatDateBR(g.deadline)}` : "";
        lines.push(`*${g.name}*${dl}\n   ${bar} ${pct}% — ${formatBRL(g.current_amount)}/${formatBRL(g.target_amount)}`);
      }
      return lines.join("\n");
    }

    const r = await (supabase.rpc as any)("agent_goal_op", {
      payload: { action: parsed.action, user_id: userId, ...parsed.params },
    });
    const data = r as any;
    if (!data?.ok) return `❌ ${data?.error || "erro"}`;

    switch (data.action) {
      case "create":
        return `✅ Meta *${data.name}* criada (alvo: ${formatBRL(data.target)}).`;
      case "add_amount": {
        const pct = data.target > 0 ? Math.round((data.current / data.target) * 100) : 0;
        return `✅ +${formatBRL(data.added)} na meta *${data.name}* (${pct}%).`;
      }
      case "update":
        return `✅ Meta *${data.name}* atualizada.`;
      case "delete":
        return `✅ Meta *${data.name}* removida.`;
      default:
        return `✅ OK`;
    }
  } catch (e) {
    return `❌ Erro: ${String(e)}`;
  }
}

// ===== ORÇAMENTO =====
function isBudgetCommand(text: string): { action: string; params: Record<string, any> } | null {
  const lc = text.trim().toLowerCase();
  const norm = lc.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const money = (s: string) => {
    const m = s.match(/r?\$?\s*([\d.,]+)/i);
    return m ? parseFloat(m[1].replace(/\./g, "").replace(",", ".")) : null;
  };

  // CREATE: "cria orcamento de 500 para restaurantes"
  let m = norm.match(/^(?:cri[ae]|nov[ao]|defin[ae])\s+orcamento\s+(?:de\s+)?([\d.,]+)\s+(?:para|pro|pra|em|de|no|na)\s+(.+?)(?:\s+(?:em|no|na)\s+(\w+\/?\d{0,4}))?\s*$/i);
  if (m) {
    const limit = money(m[1]);
    const catName = m[2].trim();
    const monthRaw = m[3];
    let month: string | null = null;
    if (monthRaw) {
      const dt = parseDateBR(monthRaw);
      if (dt) month = dt.slice(0, 7) + "-01";
    }
    if (!month) {
      const d = new Date();
      month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    }
    return { action: "create", params: { limit_amount: limit, category_name: catName, reference_month: month } };
  }

  // LIST
  if (/^(?:lista|mostra|quais|ver|meus?|minhas)\s+(?:os\s+)?orcamentos?\s*$/i.test(norm) || /^orcamentos?$/i.test(norm)) {
    return { action: "list", params: {} };
  }

  // DELETE
  m = norm.match(/^(?:remove|apaga|deleta|exclui|elimina)\s+orcamento\s+(?:de|da|do|para|em)\s+(.+)$/i);
  if (m) {
    return { action: "delete", params: { category_name: m[1].trim() } };
  }

  return null;
}

async function handleBudgetCommand(supabase: any, userId: string, parsed: { action: string; params: Record<string, any> }): Promise<string> {
  try {
    if (parsed.action === "list") {
      const r = await (supabase.rpc as any)("agent_budget_op", { payload: { action: "list", user_id: userId } });
      const data = r as any;
      if (!data?.ok) return `❌ ${data?.error || "erro"}`;
      const bs: any[] = data.budgets || [];
      if (bs.length === 0) return "📊 Nenhum orçamento cadastrado.";
      const lines: string[] = [`📊 *${bs.length} orçamento(s)*`, ``];
      for (const b of bs) {
        const monthLabel = b.reference_month ? new Date(b.reference_month).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "?";
        lines.push(`• *${b.category_name || "(sem categoria)"}* — ${formatBRL(b.limit_amount)} em ${monthLabel}`);
      }
      return lines.join("\n");
    }

    const r = await (supabase.rpc as any)("agent_budget_op", {
      payload: { action: parsed.action, user_id: userId, ...parsed.params },
    });
    const data = r as any;
    if (!data?.ok) return `❌ ${data?.error || "erro"}`;

    switch (data.action) {
      case "create":
        return `✅ Orçamento criado (limite ${formatBRL(data.limit)}).`;
      case "update":
        return `✅ Orçamento atualizado.`;
      case "delete":
        return `✅ Orçamento removido.`;
      default:
        return `✅ OK`;
    }
  } catch (e) {
    return `❌ Erro: ${String(e)}`;
  }
}

// ===== CONTA =====
function isAccountCommand(text: string): { action: string; params: Record<string, any> } | null {
  const lc = text.trim().toLowerCase();
  const norm = lc.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // LIST
  if (/^(?:lista|mostra|quais|ver|minhas|meus?)\s+(?:as\s+)?contas?\s*$/i.test(norm) || /^(?:minhas|meus?)\s+contas?$/i.test(norm)) {
    return { action: "list", params: {} };
  }

  // CREATE: "crie outra conta bancaria chamada X" / "cria conta X" / "nova conta X"
  // "adiciona conta X" / "criar conta X tipo X"
  const createMatch = norm.match(
    /^(?:cri(?:e|a|ar)|adiciona|cadastra|registra|nova?)\s+(?:outra\s+)?(?:uma\s+)?conta(?:\s+bancaria)?\s+(?:chamada|com\s+nome|de\s+nome|nova)?\s*([^,]+?)(?:\s+(?:tipo|do\s+tipo|com\s+tipo)\s+(checking|savings|credit|cash|poupanca|corrente|carteira|cartao|investimento))?\s*(?:com\s+saldo\s+([\d.,]+))?\s*$/i
  );
  if (createMatch) {
    const name = (createMatch[1] || "").trim();
    if (name && name.length >= 2) {
      return {
        action: "create",
        params: {
          name,
          type: createMatch[2] || null,
          initial_balance: createMatch[3] ? parseMoneyBR(createMatch[3]) : null,
        },
      };
    }
  }

  // RECALCULATE / LIMPAR OVERRIDE: "recalcular saldo" / "zerar saldo" / "voltar a calcular"
  if (/^(?:recalcula|recalcular|zera|zerar|limpa|limpar|reset)\s+(?:o\s+)?saldo(?:\s+(?:da?\s+)?(?:conta\s+)?(.+))?$/i.test(norm)
    || /^(?:volta|voltar)\s+(?:a|ao)\s+calcular(?:\s+(?:o\s+)?saldo)?(?:\s+(?:da?\s+)?(?:conta\s+)?(.+))?$/i.test(norm)
    || /^nao\s+usar\s+(?:mais\s+)?saldo\s+ajustado(?:\s+(?:da?\s+)?(?:conta\s+)?(.+))?$/i.test(norm)) {
    const m = norm.match(/(?:conta\s+)?(.+)$/);
    return {
      action: "clear_balance",
      params: { account_name: m?.[1]?.replace(/^(?:da?\s+|de\s+)/i, "").trim() || null },
    };
  }

  // AJUSTAR SALDO: "definir saldo da conta X para Y" / "mudar saldo X para Y" / "saldo da conta X é Y"
  const setMatch = norm.match(
    /^(?:definir|muda|alterar|altera|coloca|seta)\s+(?:o\s+)?saldo\s+(?:d[ao]\s+)?(?:conta\s+)?(.+?)\s+(?:para|em|=|e|eh|foi)\s+([\d.,]+)\s*$/i
  ) || norm.match(
    /^(?:o\s+)?saldo\s+(?:d[ao]\s+)?(?:conta\s+)?(.+?)\s+(?:para|em|=|e|eh|foi|eh\s+agora)\s+([\d.,]+)\s*$/i
  );
  if (setMatch) {
    return {
      action: "set_balance",
      params: {
        account_name: setMatch[1].trim(),
        amount: parseMoneyBR(setMatch[2]),
      },
    };
  }

  return null;
}

async function handleAccountCommand(supabase: any, userId: string, parsed: { action: string; params: Record<string, any> }): Promise<string> {
  try {
    if (parsed.action === "list") {
      const r = await (supabase.rpc as any)("agent_account_op", { payload: { action: "list", user_id: userId } });
      const data = r as any;
      if (!data?.ok) return `❌ ${data?.error || "erro"}`;
      const accs: any[] = data.accounts || [];
      if (accs.length === 0) return "💳 Nenhuma conta cadastrada.";
      const lines: string[] = [`💳 *${accs.length} conta(s)*`, ``];
      for (const a of accs) {
        const hasOverride = a.current_balance_override !== null && a.current_balance_override !== undefined;
        const bal = hasOverride ? `${formatBRL(a.current_balance_override)} 🔧` : `calculado`;
        lines.push(`• *${a.name}* (${a.type}) — ${bal}`);
      }
      return lines.join("\n");
    }

    if (parsed.action === "create") {
      let type = parsed.params.type;
      if (!type) {
        const nl = (parsed.params.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (/(poupanca|poupança)/i.test(nl)) type = "savings";
        else if (/(cartao|cartão|credito|crédito)/i.test(nl)) type = "credit";
        else if (/(carteira|dinheiro|cash)/i.test(nl)) type = "cash";
        else if (/(investimento|cripto|acao|tesouro)/i.test(nl)) type = "investment";
        else type = "checking";
      }
      const payload: any = {
        action: "create",
        user_id: userId,
        name: parsed.params.name,
        type,
      };
      if (parsed.params.initial_balance != null && Number.isFinite(parsed.params.initial_balance)) {
        payload.initial_balance = parsed.params.initial_balance;
      }
      const r = await (supabase.rpc as any)("agent_account_op", { payload });
      const data = r as any;
      if (!data?.ok) {
        if (data?.error === "duplicate_name") return `❌ Já existe uma conta com esse nome.`;
        return `❌ ${data?.error || "erro"}`;
      }
      const typeLabel: Record<string, string> = {
        checking: "Conta corrente",
        savings: "Poupança",
        credit: "Cartão de crédito",
        cash: "Carteira",
        investment: "Investimento",
      };
      const init = parsed.params.initial_balance != null ? ` com saldo inicial ${formatBRL(parsed.params.initial_balance)}` : "";
      return `✅ *${data.name}* criada (${typeLabel[type] || type})${init}.\nJá pode usar no próximo gasto/receita.`;
    }

    if (parsed.action === "set_balance" || parsed.action === "clear_balance") {
      const payload: any = {
        action: parsed.action,
        user_id: userId,
      };
      if (parsed.params.account_name) payload.name = parsed.params.account_name;
      if (parsed.params.amount != null) payload.balance = parsed.params.amount;
      const r = await (supabase.rpc as any)("agent_account_op", { payload });
      const data = r as any;
      if (!data?.ok) {
        const err = String(data?.error || "");
        if (err.includes("não encontrada") || err.includes("encontrada") || err.includes("not found")) {
          return `❌ Conta não encontrada. Use \`minhas contas\` para ver os nomes.`;
        }
        return `❌ ${data?.error || "erro"}`;
      }
      if (parsed.action === "set_balance") {
        return `✅ Saldo de *${data.name}* definido para ${formatBRL(data.balance)} 🔧.\n\n💡 _Lembre-se: ao registrar novas transações, esse ajuste manual é removido automaticamente e o saldo volta a ser calculado._`;
      } else {
        return `✅ Override removido de *${data.name}*. Saldo agora é calculado pelas transações.`;
      }
    }

    return "❓ Comando não reconhecido.";
  } catch (e) {
    return `❌ Erro: ${String(e)}`;
  }
}

// ===== TRANSAÇÃO (list/delete) =====
function isTransactionCommand(text: string): { action: string; params: Record<string, any> } | null {
  const lc = text.trim().toLowerCase();
  // Normaliza para facilitar match (sem acentos)
  const norm = lc.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // LIST: "últimas transações" / "mostra transações" / "transações da semana"
  let m = norm.match(/^(?:lista|mostra|ver|quais|minhas|meus?)\s+(?:as\s+)?(?:ultimas\s+)?(?:(\d+)\s+)?transacoes(?:\s+de\s+(\w+))?\s*$/i);
  if (m) {
    const limit = m[1] ? parseInt(m[1]) : 10;
    const period = m[2] || "semana";
    const days = period === "hoje" ? 1 : period === "semana" ? 7 : period === "mes" ? 30 : 7;
    return { action: "list", params: { limit, days } };
  }
  if (/^(?:ultimas\s+)?(?:minhas\s+)?transacoes$/i.test(norm)) {
    return { action: "list", params: { limit: 10, days: 7 } };
  }

  // DELETE RECENT
  if (/^(?:desfaz|apaga|remove|deleta|exclui)\s+(?:a\s+)?ultima\s+transacao$/i.test(norm)) {
    return { action: "delete_recent", params: {} };
  }

  return null;
}

async function handleTransactionCommand(supabase: any, userId: string, parsed: { action: string; params: Record<string, any> }): Promise<string> {
  try {
    if (parsed.action === "list") {
      const r = await (supabase.rpc as any)("agent_transaction_op", {
        payload: { action: "list", user_id: userId, limit: parsed.params.limit || 10, days: parsed.params.days || 7 },
      });
      const data = r as any;
      if (!data?.ok) return `❌ ${data?.error || "erro"}`;
      const txs: any[] = data.transactions || [];
      if (txs.length === 0) return "📋 Nenhuma transação nesse período.";
      const lines: string[] = [`📋 *${txs.length} transação(ões)*`, ``];
      for (const t of txs) {
        const emoji = t.type === "expense" ? "💸" : "💰";
        const sign = t.type === "expense" ? "-" : "+";
        const cat = t.category_name ? ` · ${t.category_name}` : "";
        const acc = t.account_name ? ` · ${t.account_name}` : "";
        lines.push(`${emoji} ${sign}${formatBRL(t.amount)} — *${t.description}*${cat}\n   📅 ${formatDateBR(t.transaction_date)}${acc}`);
      }
      return lines.join("\n");
    }

    if (parsed.action === "delete_recent") {
      const r = await (supabase.rpc as any)("agent_transaction_op", { payload: { action: "delete_recent", user_id: userId } });
      const data = r as any;
      if (!data?.ok) return `❌ ${data?.error || "erro"}`;
      return `✅ Última transação (*${data.description}*) removida.`;
    }

    return "❓ Comando não reconhecido.";
  } catch (e) {
    return `❌ Erro: ${String(e)}`;
  }
}

// ===== WHATSAPP PHONES (list/add/remove/set_primary) =====
function isPhoneCommand(text: string): { action: string; params: Record<string, any> } | null {
  const lc = text.trim().toLowerCase();
  const norm = lc.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (/^(?:lista|mostra|quais|ver|meus?)\s+(?:os\s+)?numeros?\s*(?:de\s+whatsapp)?\s*$/i.test(norm)
    || /^(?:meus?)\s+numeros?\s*$/i.test(norm)
    || /^numeros\s+cadastrados\s*$/i.test(norm)) {
    return { action: "list", params: {} };
  }

  // ADD: "adiciona numero 44999998888" / "cadastra meu whatsapp 44999998888" / "novo numero 44999998888 Trabalho"
  const addMatch = norm.match(/^(?:adiciona|cadastra|registra|novo|adicionar|cadastrar)\s+(?:numero|whatsapp|num|telefone)?\s*(\d{10,13})(?:\s+(?:como|rotulado|com nome|chamado|rotulo)\s+(.+))?$/i)
    || norm.match(/^(?:adiciona|cadastra|registra|novo)\s+(?:numero|whatsapp|num|telefone)\s+(\d{10,13})(?:\s+(.+))?$/i);
  if (addMatch) {
    return {
      action: "add",
      params: {
        phone: addMatch[1],
        label: addMatch[2]?.trim() || null,
      },
    };
  }

  // REMOVE: "remove numero 44999998888" / "deleta 44999998888"
  const removeMatch = norm.match(/^(?:remove|apaga|deleta|exclui|remover)\s+(?:numero|whatsapp|num)?\s*(\d{10,13})\s*$/i);
  if (removeMatch) {
    return { action: "remove", params: { phone: removeMatch[1] } };
  }

  // SET PRIMARY: "torna 44999998888 principal" / "define 44999998888 como principal"
  const primaryMatch = norm.match(/^(?:torna|define|faz)\s+(\d{10,13})\s+(?:como\s+)?principal\s*$/i)
    || norm.match(/^(\d{10,13})\s+(?:como\s+)?principal\s*$/i);
  if (primaryMatch) {
    return { action: "set_primary", params: { phone: primaryMatch[1] } };
  }

  return null;
}

async function handlePhoneCommand(supabase: any, userId: string, parsed: { action: string; params: Record<string, any> }): Promise<string> {
  try {
    if (parsed.action === "list") {
      const r = await (supabase.rpc as any)("agent_phone_op", { payload: { action: "list", user_id: userId } });
      const data = r as any;
      if (!data?.ok) return `❌ ${data?.error || "erro"}`;
      const phones: any[] = data.phones || [];
      if (phones.length === 0) {
        return `📱 Nenhum número cadastrado.\n\nAcesse *Configurações* no app para adicionar.`;
      }
      const lines: string[] = [`📱 *${phones.length} número(s) cadastrado(s)*`, ``];
      for (const p of phones) {
        const star = p.is_primary ? " ⭐" : "";
        const verified = p.verified ? "✓" : "pendente";
        const last = p.last_seen_at ? ` (visto ${formatDateBR(p.last_seen_at)})` : "";
        const label = p.label ? ` _${p.label}_` : "";
        lines.push(`•${star} *${p.phone}*${label} — ${verified}${last}`);
      }
      lines.push(``, `⭐ = principal · ✓ = verificado`);
      return lines.join("\n");
    }

    if (parsed.action === "add") {
      const r = await (supabase.rpc as any)("agent_phone_op", {
        payload: {
          action: "add",
          user_id: userId,
          phone: parsed.params.phone,
          label: parsed.params.label,
        },
      });
      const data = r as any;
      if (!data?.ok) {
        if (data?.error === "phone_in_use_by_other_user") return `❌ Esse número já está vinculado a outra conta.`;
        return `❌ ${data?.error || "erro"}`;
      }
      return `✅ Número *${data.phone}* adicionado.\nJá pode enviar mensagens por ele.`;
    }

    if (parsed.action === "remove") {
      const r = await (supabase.rpc as any)("agent_phone_op", {
        payload: { action: "remove", user_id: userId, phone: parsed.params.phone },
      });
      const data = r as any;
      if (!data?.ok) return `❌ ${data?.error || "erro"}`;
      return `✅ Número *${parsed.params.phone}* removido.`;
    }

    if (parsed.action === "set_primary") {
      const r = await (supabase.rpc as any)("agent_phone_op", {
        payload: { action: "set_primary", user_id: userId, phone: parsed.params.phone },
      });
      const data = r as any;
      if (!data?.ok) return `❌ ${data?.error || "erro"}`;
      return `✅ *${parsed.params.phone}* agora é o número principal.`;
    }

    return "❓ Comando não reconhecido.";
  } catch (e) {
    return `❌ Erro: ${String(e)}`;
  }
}

// ============ MAIN ============
Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json" };
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
  }
  const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
  if (webhookSecret) {
    const authHeader = req.headers.get("authorization") || "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
    const headerToken = req.headers.get("x-webhook-secret") || "";
    const queryToken = new URL(req.url).searchParams.get("secret") || "";
    const providedToken = bearerToken || headerToken || queryToken;
    if (providedToken !== webhookSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
    }
  }

  let remoteJidForReply = "";
  try {
    const body = await req.json();
    const event = (body?.event || body?.type || "") as string;
    const data = (body?.data || body || {}) as Record<string, any>;
    const fromMe = data?.key?.fromMe === true;
    // WhatsApp Business 2025+ envia LID em um dos campos. Preferimos o que NÃO termina com @lid
    const remoteJid = (data?.key?.remoteJid || "") as string;
    const remoteJidAlt = (data?.key?.remoteJidAlt || "") as string;
    const jid = (!remoteJid.endsWith("@lid") ? remoteJid : remoteJidAlt) || remoteJid || remoteJidAlt;
    remoteJidForReply = jid;
    const message = (data?.message || {}) as Record<string, any>;
    const text = (message?.conversation || message?.extendedTextMessage?.text || "") as string;
    const messageId = (data?.key?.id || "") as string;
    // Phone extraction: pega só dígitos, remove o nono dígito se necessário
    let phone = jid.split("@")[0] || "";
    if (/^\d{12,13}$/.test(phone) && phone.startsWith("55")) {
      const ddd = phone.substring(2, 4);
      const rest = phone.substring(4);
      // Se o número tem 9 dígitos (celular) e o nono é 9, remove
      if (rest.length === 9 && rest.startsWith("9")) {
        phone = "55" + ddd + rest.substring(1);
      }
    }

    // DEBUG: log de diagnóstico
    console.log("DEBUG_WEBHOOK:", JSON.stringify({
      remoteJid, remoteJidAlt, jid_used: jid, phone_extracted: phone, fromMe, text: text.substring(0, 50),
    }));

    if (event && event !== "messages.upsert" && !text) {
      return new Response(JSON.stringify({ ignored: true, event }), { status: 200, headers: cors });
    }
    if (fromMe) {
      return new Response(JSON.stringify({ ignored: "fromMe" }), { status: 200, headers: cors });
    }
    if (!text) {
      return new Response(JSON.stringify({ ignored: "no_text" }), { status: 200, headers: cors });
    }

    // Resolve user
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );
    let userId: string | null = (body?.user_id as string) || null;
    if (!userId && phone) {
      const { data: phoneRow } = await supabase
        .from("whatsapp_phones").select("user_id").eq("phone", phone).maybeSingle();
      if (phoneRow?.user_id) {
        userId = phoneRow.user_id as string;
        // Atualiza last_seen_at em background
        supabase
          .from("whatsapp_phones")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("phone", phone)
          .then(() => {}, () => {});
      } else {
        // Fallback de compatibilidade: profiles.phone antigo
        const { data: profile } = await supabase
          .from("profiles").select("id, phone").eq("phone", phone).maybeSingle();
        if (profile?.id) {
          userId = profile.id as string;
          // Migração automática: inserir em whatsapp_phones
          const cleanPhone = (profile.phone ?? phone).replace(/\D/g, "");
          if (cleanPhone) {
            await supabase
              .from("whatsapp_phones")
              .upsert(
                { user_id: userId, phone: cleanPhone, label: "Principal", is_primary: true, verified: true },
                { onConflict: "user_id,phone" }
              );
          }
        }
      }
    }

    // Fallback: tenta resolver via messageId em transações anteriores
    if (!userId && messageId) {
      const { data: prev } = await supabase
        .from("transactions")
        .select("user_id")
        .eq("external_message_id", messageId)
        .maybeSingle();
      if (prev?.user_id) userId = prev.user_id as string;
    }
    if (!userId) {
      const reply = buildNoUserReply(phone || "desconhecido");
      await sendWhatsAppReply(remoteJidForReply, reply);
      // Diagnóstico: gravar payload na tabela para debug
      await supabase.from("webhook_events").insert({
        provider: "evolution_api",
        event_type: "debug_no_user",
        payload: { remoteJid: data?.key?.remoteJid, remoteJidAlt: data?.key?.remoteJidAlt, participant: data?.key?.participant, jid_used: jid, phone_extracted: phone, raw_key: data?.key, raw_message: data?.message, text } as any,
        processed: false,
        error_message: `Could not resolve user_id from phone ${phone}`,
      });
      return new Response(JSON.stringify({ error: "no_user", phone, reply_sent: true }), { status: 400, headers: cors });
    }

    // Envia "digitando..." imediatamente (fire-and-forget).
    // Para chat com Gemini (mais lento), aumentamos o delay.
    const isLikelySlow = isQueryIntent(text) || /^(dica|conselho|tip)/i.test(text.trim()) || text.length > 30;
    sendTyping(remoteJidForReply, isLikelySlow ? 5000 : 2500);

    // === DETECÇÃO DE INTENÇÃO ===

    // 1) Comando rápido
    const cmd = await detectCommand(text);
    if (cmd) {
      const reply = await cmd(supabase, userId);
      const sent = await sendWhatsAppReply(remoteJidForReply, reply);
      return new Response(JSON.stringify({ ok: true, intent: "command", reply_sent: sent }), { status: 200, headers: cors });
    }

    // 2) Comando de ajuste manual (zere, some, tira, etc) — ANTES de tudo
    if (isAdjustmentCommand(text)) {
      const reply = await handleManualAdjustment(supabase, userId, text);
      const sent = await sendWhatsAppReply(remoteJidForReply, reply);
      return new Response(JSON.stringify({ ok: true, intent: "adjustment", reply_sent: sent }), { status: 200, headers: cors });
    }

    // 2.5) Definir saldo diretamente: "mude o saldo do X para Y" / "recalcule o saldo"
    //     Guarda: se tem verbo claro de transação (comprei/gastei/saiu etc),
    //     não tratar como ajuste de saldo — deixa a transação ser parseada.
    if (isBalanceSetCommand(text) && !hasTransactionVerb(text)) {
      const reply = await handleBalanceSet(supabase, userId, text);
      const sent = await sendWhatsAppReply(remoteJidForReply, reply);
      return new Response(JSON.stringify({ ok: true, intent: "balance_set", reply_sent: sent }), { status: 200, headers: cors });
    }

    // 2.6) Comandos CRUD do agente (categoria, meta, orçamento, conta, transação)
    //      ANTES de tentar transação/query para evitar falsos positivos
    const catCmd = isCategoryCommand(text);
    if (catCmd) {
      const reply = await handleCategoryCommand(supabase, userId, catCmd);
      const sent = await sendWhatsAppReply(remoteJidForReply, reply);
      return new Response(JSON.stringify({ ok: true, intent: "category_" + catCmd.action, reply_sent: sent }), { status: 200, headers: cors });
    }
    const goalCmd = isGoalCommand(text);
    if (goalCmd) {
      const reply = await handleGoalCommand(supabase, userId, goalCmd);
      const sent = await sendWhatsAppReply(remoteJidForReply, reply);
      return new Response(JSON.stringify({ ok: true, intent: "goal_" + goalCmd.action, reply_sent: sent }), { status: 200, headers: cors });
    }
    const budCmd = isBudgetCommand(text);
    if (budCmd) {
      const reply = await handleBudgetCommand(supabase, userId, budCmd);
      const sent = await sendWhatsAppReply(remoteJidForReply, reply);
      return new Response(JSON.stringify({ ok: true, intent: "budget_" + budCmd.action, reply_sent: sent }), { status: 200, headers: cors });
    }
    const accCmd = isAccountCommand(text);
    if (accCmd) {
      const reply = await handleAccountCommand(supabase, userId, accCmd);
      const sent = await sendWhatsAppReply(remoteJidForReply, reply);
      return new Response(JSON.stringify({ ok: true, intent: "account_" + accCmd.action, reply_sent: sent }), { status: 200, headers: cors });
    }
    const txCmd = isTransactionCommand(text);
    if (txCmd) {
      const reply = await handleTransactionCommand(supabase, userId, txCmd);
      const sent = await sendWhatsAppReply(remoteJidForReply, reply);
      return new Response(JSON.stringify({ ok: true, intent: "transaction_" + txCmd.action, reply_sent: sent }), { status: 200, headers: cors });
    }
    const phoneCmd = isPhoneCommand(text);
    if (phoneCmd) {
      const reply = await handlePhoneCommand(supabase, userId, phoneCmd);
      const sent = await sendWhatsAppReply(remoteJidForReply, reply);
      return new Response(JSON.stringify({ ok: true, intent: "phone_" + phoneCmd.action, reply_sent: sent }), { status: 200, headers: cors });
    }

    // 3) "dica" explícito → Gemini com contexto
    if (/^(dica|conselho|tip)/i.test(text.trim())) {
      const ctx = await buildContext(supabase, userId);
      const reply = await chatWithGemini("Me dê uma dica financeira personalizada baseada no meu contexto atual", ctx);
      const sent = await sendWhatsAppReply(remoteJidForReply, `💡 *Dica do agente*\n\n${reply}`);
      return new Response(JSON.stringify({ ok: true, intent: "tip", reply_sent: sent }), { status: 200, headers: cors });
    }

    // 4) Tenta parsear como TRANSAÇÃO PRIMEIRO — se tem valor monetário + verbo de movimento
    let parsed = parseWithRegex(text);
    let parser_used: "regex" | "gemini" = "regex";
    if (!parsed) {
      parsed = await parseWithGemini(text);
      parser_used = "gemini";
    }

    if (parsed) {
      // Se tem valor monetário explícito E a query não tem "total/quanto/qual/soma/resumo"
      // → é transação, não consulta
      const looksLikeQuery = isQueryIntent(text) && /(total|quanto|qual|soma|resumo|ate\s+(agora|hoje|o\s*momento))/i.test(text);
      if (looksLikeQuery && !hasExplicitAmount(text)) {
        // Caso genuíno de consulta
        const reply = await handleQuery(supabase, userId, text);
        const sent = await sendWhatsAppReply(remoteJidForReply, reply);
        return new Response(JSON.stringify({ ok: true, intent: "query", reply_sent: sent }), { status: 200, headers: cors });
      }
    } else if (isQueryIntent(text)) {
      // Não tem parsed, é consulta
      const reply = await handleQuery(supabase, userId, text);
      const sent = await sendWhatsAppReply(remoteJidForReply, reply);
      return new Response(JSON.stringify({ ok: true, intent: "query", reply_sent: sent }), { status: 200, headers: cors });
    }

    if (parsed) {
      // Inserir transação
      // WhatsApp = usuário autenticado por telefone (já verificamos que o número pertence a ele).
      // Por isso a transação pode entrar como 'confirmed' direto (soma no saldo imediato).
      // Só vai pra 'pending_review' se confidence for muito baixa (< 0.5), o que é improvável
      // pois a mensagem veio do dono do número.
      const txStatus = parsed.confidence_score >= 0.5 ? "confirmed" : "pending_review";
      // Tenta resolver a conta mencionada no texto (ex: "Saiu da conta PJ")
      const txAccount = await resolveAccount(supabase, userId, text);
      const transactionPayload: Record<string, any> = {
        user_id: userId,
        type: parsed.type, amount: parsed.amount, description: parsed.description,
        source: "whatsapp", external_message_id: messageId || null,
        status: txStatus,
        confidence_score: parsed.confidence_score,
        transaction_date: todayISO(),
        provider: "evolution_api",
      };
      if (txAccount) transactionPayload.account_id = txAccount.id;
      if (parsed.category_name) transactionPayload.category_name = parsed.category_name;

      const { data: txId, error } = await supabase.rpc("ingest_transaction_from_agent", { payload: transactionPayload });
      if (error) {
        await sendWhatsAppReply(remoteJidForReply, `❌ *Erro ao registrar*\n\n${error.message}`);
        return new Response(JSON.stringify({ error: error.message, reply_sent: true }), { status: 500, headers: cors });
      }

      const { data: txConfirmed, error: txErr } = await supabase
        .from("transactions")
        .select(`id, type, amount, description, transaction_date, status, confidence_score, category:categories!transactions_category_id_fkey(name, icon, color), account:accounts(name, type)`)
        .eq("id", txId).maybeSingle();

      if (!txConfirmed) {
        console.error("post_insert_fetch_failed", txId, "err:", txErr);
        return new Response(JSON.stringify({ error: "post_insert_fetch_failed", txId, detail: txErr?.message }), { status: 500, headers: cors });
      }

      // Monta resposta base
      let reply = buildSuccessReply(txConfirmed);

      // Comentário proativo (se for despesa)
      if (parsed.type === "expense") {
        const insight = await proactiveInsight(supabase, userId, txConfirmed.category?.name, Number(txConfirmed.amount));
        if (insight) reply += `\n\n${insight}`;
        const goalAlert = await checkGoalAlerts(supabase, userId);
        if (goalAlert) reply += `\n\n${goalAlert}`;
      }

      const sent = await sendWhatsAppReply(remoteJidForReply, reply);
      return new Response(JSON.stringify({ ok: true, intent: "transaction", parser: parser_used, transaction_id: txId, reply_sent: sent }), { status: 200, headers: cors });
    }

    // 5) Modo conversa livre (Gemini com contexto)
    const ctx = await buildContext(supabase, userId);
    const reply = await chatWithGemini(text, ctx);
    const sent = await sendWhatsAppReply(remoteJidForReply, reply);
    return new Response(JSON.stringify({ ok: true, intent: "chat", reply_sent: sent }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: "bad_payload", detail: String(e) }), { status: 400, headers: cors });
  }
});
