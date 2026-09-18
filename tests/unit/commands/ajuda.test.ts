import { describe, it, expect, vi } from 'vitest';
import { handleAjuda, obterConteudoAjuda, buildAjudaMenuKeyboard, buildAjudaTopicoKeyboard } from '../../../src/bot/commands/ajuda';

describe('ajuda — módulo de ajuda interativa (/ajuda)', () => {
  it('gera menu principal com todos os tópicos e botões esperados', () => {
    const { texto, teclado } = obterConteudoAjuda('menu');
    expect(texto).toContain('CENTRAL DE AJUDA & TUTORIAIS');
    expect(texto).toContain('Guará IA');
    expect(teclado.inline_keyboard.length).toBeGreaterThanOrEqual(4);
    
    const botoes = teclado.inline_keyboard.flat().map((b) => b.text);
    expect(botoes).toContain('💸 Gastos & Compras');
    expect(botoes).toContain('💰 Entradas & Saldos');
    expect(botoes).toContain('💳 Cartões & Faturas');
    expect(botoes).toContain('📈 Investimentos & Metas');
    expect(botoes).toContain('⚙️ Comandos & Gestão');
  });

  it('retorna conteúdo e teclado de retorno para cada tópico específico', () => {
    const topicos = ['gastos', 'entradas', 'cartoes', 'investimentos', 'comandos'] as const;

    for (const topico of topicos) {
      const { texto, teclado } = obterConteudoAjuda(topico);
      expect(texto.length).toBeGreaterThan(50);
      expect(teclado.inline_keyboard[0][0].text).toContain('Voltar ao Menu de Ajuda');
      expect(teclado.inline_keyboard[0][0].callback_data).toBe('ajuda:menu');

      // Verifica formatação Markdown com número par de delimitadores
      const semEscapes = texto.replace(/\\([_*`\[])/g, '');
      const asteriscos = (semEscapes.match(/\*/g) || []).length;
      const underscores = (semEscapes.match(/_/g) || []).length;
      expect(asteriscos % 2).toBe(0);
      expect(underscores % 2).toBe(0);
    }
  });

  it('handleAjuda envia mensagem com parse_mode Markdown e teclado correspondente', async () => {
    const mockBot = {
      sendMessage: vi.fn().mockResolvedValue(true),
    } as any;

    await handleAjuda(123456, 'gastos', mockBot);

    expect(mockBot.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, options] = mockBot.sendMessage.mock.calls[0];

    expect(chatId).toBe(123456);
    expect(options.parse_mode).toBe('Markdown');
    expect(text).toContain('COMO LANÇAR GASTOS & COMPRAS');
    expect(options.reply_markup).toEqual(buildAjudaTopicoKeyboard());
  });
});
