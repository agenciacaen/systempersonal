// Substitui caracteres corrompidos (U+FFFD) e mojibakes comuns
// (UTF-8 lido como Windows-1252/Latin-1) por seus equivalentes corretos.
// Aplicar em qualquer texto que venha do banco ou de inputs externos.

const REPLACEMENT = /\uFFFD/g

const MOJIBAKE_PAIRS: Array<[string, string]> = [
  ["Ã¡", "á"],
  ["Ã©", "é"],
  ["Ã­", "í"],
  ["Ã³", "ó"],
  ["Ãº", "ú"],
  ["Ã ", "à"],
  ["Ã¨", "è"],
  ["Ã¬", "ì"],
  ["Ã²", "ò"],
  ["Ã¹", "ù"],
  ["Ã¢", "â"],
  ["Ãª", "ê"],
  ["Ã®", "î"],
  ["Ã´", "ô"],
  ["Ã»", "û"],
  ["Ã£", "ã"],
  ["Ã±", "ñ"],
  ["Ãµ", "õ"],
  ["Ã§", "ç"],
  ["Ã‰", "É"],
  ["Ã", "Á"],
  ["Ãƒ", "Ã"],
  ["Â°", "°"],
]

// Mojibakes que envolvem 3 ou mais bytes (sequências CP-1252 + UTF-8)
const MULTI_BYTE_FIXES: Array<[RegExp, string]> = [
  [/â€™/g, "’"],
  [/â€œ/g, "“"],
  [/â€/g, "”"],
  [/â€“/g, "–"],
  [/â€”/g, "—"],
  [/â€¦/g, "…"],
  [/â€¢/g, "•"],
  [/Â /g, " "],
]

export function normalizeText(value: unknown): string {
  if (value == null) return ""
  let s = typeof value === "string" ? value : String(value)

  if (s.includes("\uFFFD")) {
    s = s
      .replace(/\uFFFD\u0080\uFFFD\u0099/g, "™")
      .replace(/\uFFFD\u0080\uFFFD\u009C/g, "œ")
      .replace(/\uFFFD\u0080\uFFFD\u0093/g, "“")
      .replace(/\uFFFD\u0080\uFFFD\u009D/g, "”")
      .replace(/\uFFFD\u0080\uFFFD\u0098/g, "˜")
      .replace(/\uFFFD\u0080\uFFFD\u00A9/g, "©")
      .replace(/\uFFFD\u0080\uFFFD\u00AE/g, "®")
      .replace(/\uFFFD\u0080\uFFFD\u00A6/g, "¦")
      .replace(/\uFFFD\u0080\uFFFD\u00A2/g, "¢")
      .replace(/\uFFFD\u0080\uFFFD\u00A0/g, "€")
  }

  for (const [bad, good] of MOJIBAKE_PAIRS) {
    if (s.includes(bad)) s = s.split(bad).join(good)
  }

  for (const [pattern, replacement] of MULTI_BYTE_FIXES) {
    s = s.replace(pattern, replacement)
  }

  s = s.replace(REPLACEMENT, "")

  return s
}

export function normalizeCategoryName(name: string | null | undefined): string {
  const fixed = normalizeText(name).trim()
  if (!fixed) return "Sem categoria"
  return fixed
}

export function normalizeList<T>(
  list: T[] | null | undefined,
  getKey: (item: T) => string | null | undefined,
): T[] {
  if (!list) return []
  const seen = new Map<string, T>()
  for (const item of list) {
    const key = normalizeText(getKey(item)).toLowerCase()
    if (!key) continue
    if (!seen.has(key)) seen.set(key, item)
  }
  return Array.from(seen.values())
}
