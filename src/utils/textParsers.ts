export function extrairValor(txt?: string): number | undefined {
  if (!txt) return undefined;
  const semPrefixo = txt.replace(/r\$\s*/i, '');
  const match = semPrefixo.match(/([\d]+(?:[.,]\d{1,2})?)/);
  if (!match) return undefined;
  return parseFloat(match[1].replace(',', '.'));
}

export function separarNomeValor(texto: string): { nome: string; valor?: number } {
  const regexValorFinal = /\s+(?:r\$\s*)?([\d]+(?:[.,]\d{1,2})?)\s*(?:reais)?\s*$/i;
  const match = texto.match(regexValorFinal);
  if (match) {
    return {
      nome: texto.slice(0, match.index).trim(),
      valor: parseFloat(match[1].replace(',', '.')),
    };
  }
  return { nome: texto.trim() };
}

// classificarIntencao() decide SE a mensagem é sobre um pagamento; esta
// regex extrai QUEM pagou e QUANTO a partir de frases livres como
// "minha irmã já pagou" ou "a Maria me pagou 25 reais".
const REGEX_PAGAMENTO = /^(?:minha\s+|meu\s+|a\s+|o\s+)?(.+?)\s+(?:j[áa]\s+)?(?:me\s+)?pagou(?:\s+(.+))?$/i;

export function extrairNomeEValorDeFrase(texto: string): { nome: string; valor?: number } | null {
  const match = texto.match(REGEX_PAGAMENTO);
  if (!match) return null;

  const nome = match[1].trim();
  if (!nome) return null;

  return { nome, valor: extrairValor(match[2]) };
}