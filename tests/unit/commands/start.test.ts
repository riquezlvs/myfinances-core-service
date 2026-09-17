import { describe, it, expect, vi } from 'vitest';
import { handleStart, handleComandos, buildStartKeyboard } from '../../../src/bot/commands/start';

describe('handleStart (/start)', () => {
  it('envia mensagem de onboarding pedagógico com Markdown válido e teclado inline', async () => {
    const mockBot = {
      sendMessage: vi.fn().mockResolvedValue(true),
    } as any;

    await handleStart(123456, mockBot);

    expect(mockBot.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, options] = mockBot.sendMessage.mock.calls[0];

    expect(chatId).toBe(123456);
    expect(options.parse_mode).toBe('Markdown');
    expect(options.reply_markup).toEqual(buildStartKeyboard());
    expect(text).toContain('Bem-vindo ao MyFinances');
    expect(text).toContain('COMO USAR — GUIA EM 4 PASSOS');
    expect(text).toContain('/ajustar\\_saldo');
    expect(text).toContain('/patrimonio');
    expect(text).toContain('/saldo');
    expect(text).toContain('/investimentos');

    // Validação de Markdown do Telegram: asteriscos (*) e underscores não escapados (_) devem ser estritamente pares
    const semEscapes = text.replace(/\\([_*`\[])/g, '');
    const asteriscos = (semEscapes.match(/\*/g) || []).length;
    const underscores = (semEscapes.match(/_/g) || []).length;

    expect(asteriscos % 2).toBe(0);
    expect(underscores % 2).toBe(0);
  });

  it('handleComandos (/comandos) envia lista estruturada com Markdown íntegro', async () => {
    const mockBot = {
      sendMessage: vi.fn().mockResolvedValue(true),
    } as any;

    await handleComandos(123456, mockBot);

    expect(mockBot.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, options] = mockBot.sendMessage.mock.calls[0];

    expect(chatId).toBe(123456);
    expect(options.parse_mode).toBe('Markdown');
    expect(text).toContain('🧭 *ÍNDICE COMPLETO DE COMANDOS*');
    expect(text).toContain('/patrimonio');
    expect(text).toContain('/ajustar\\_saldo');

    const semEscapes = text.replace(/\\([_*`\[])/g, '');
    const asteriscos = (semEscapes.match(/\*/g) || []).length;
    const underscores = (semEscapes.match(/_/g) || []).length;

    expect(asteriscos % 2).toBe(0);
    expect(underscores % 2).toBe(0);
  });
});
