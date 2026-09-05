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

/** Prompt multimodal: transcreve o áudio e extrai intenção + transação de uma vez. */
export function buildAudioPrompt(agoraISO: string): string {
  return [
    `Data e hora atuais de referência: ${agoraISO} (timezone America/Sao_Paulo).`,
    'Ouça o áudio a seguir e faça, em uma única resposta:',
    '1) Transcreva-o literalmente no campo "transcricao" (no idioma falado).',
    '2) Classifique a intenção no campo "intent".',
    '3) Se a intenção for NOVO_GASTO, preencha "transaction" com os dados estruturados ' +
      'do gasto (resolvendo datas relativas com a referência acima); caso contrário, ' +
      'retorne transaction = null.',
  ].join('\n');
}

export function buildIntentPrompt(texto: string): string {
  return `Classifique a intenção da seguinte mensagem de um bot financeiro pessoal: "${texto}"`;
}

/**
 * Fase 5 — Prompt analítico do /insight: recebe os agregados do mês já
 * estruturados em texto e pede observações + conselhos acionáveis.
 */
export function buildInsightPrompt(agregados: string): string {
  return [
    'Você é um assistente financeiro pessoal objetivo e direto.',
    'Analise os dados de gastos do mês abaixo de um usuário brasileiro e responda em português,',
    'em no máximo 8 linhas curtas, com:',
    '1) 2-3 observações concretas sobre o padrão de gastos (cite números e categorias);',
    '2) 1-2 conselhos práticos e acionáveis para o próximo mês.',
    'Não invente dados que não estão nos agregados. Não use markdown pesado (sem tabelas).',
    '',
    'DADOS DO MÊS:',
    agregados,
  ].join('\n');
}
