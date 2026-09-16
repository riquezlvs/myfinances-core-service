import { describe, it, expect, vi } from 'vitest';
import { handleStart } from '../../../src/bot/commands/start';

describe('handleStart (/start)', () => {
  it('envia mensagem de boas-vindas com Markdown válido e sem entidades órfãs', async () => {
    const mockBot = {
      sendMessage: vi.fn().mockResolvedValue(true),
    } as any;

    await handleStart(123456, mockBot);

    expect(mockBot.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, options] = mockBot.sendMessage.mock.calls[0];

    expect(chatId).toBe(123456);
    expect(options).toEqual({ parse_mode: 'Markdown' });
    expect(text).toContain('👋 *Bem-vindo ao MyFinances!*');
    expect(text).toContain('/ajustar\\_saldo');

    // Validação de Markdown do Telegram: asteriscos (*) e underscores não escapados (_) devem ser pares
    const semEscapes = text.replace(/\\([_*`\[])/g, '');
    const asteriscos = (semEscapes.match(/\*/g) || []).length;
    const underscores = (semEscapes.match(/_/g) || []).length;

    expect(asteriscos % 2).toBe(0);
    expect(underscores % 2).toBe(0);
  });
});
