/**
 * Monta o prompt de extração injetando a data/hora atual — é isso que
 * habilita o parsing de expressões relativas ("ontem ao meio-dia").
 */
export function buildTransactionPrompt(texto: string, agoraISO: string): string {
  return [
    `Data e hora atuais de referência: ${agoraISO} (timezone America/Sao_Paulo).`,
    'Use essa referência para resolver qualquer data/hora relativa mencionada na mensagem abaixo.',
    `Extraia os dados estruturados do seguinte lançamento financeiro: "${texto}"`,
  ].join('\n');
}

export function buildIntentPrompt(texto: string): string {
  return `Classifique a intenção da seguinte mensagem de um bot financeiro pessoal: "${texto}"`;
}