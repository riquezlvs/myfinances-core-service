import { describe, it, expect, vi } from 'vitest';

import { configureBot, montarFotoPerfil, prepararFotoPerfil } from '../../../src/bot/setupBot';



vi.mock('../../../src/utils/logger', () => ({

  log: vi.fn(),

}));



function criarBotMock() {

  return {

    setMyName: vi.fn().mockResolvedValue(true),

    setMyShortDescription: vi.fn().mockResolvedValue(true),

    setMyDescription: vi.fn().mockResolvedValue(true),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any

  } as any;

}



describe('setupBot — configureBot (identidade do Guará IA)', () => {

  it('configura nome, descrição curta e descrição longa com o BOT_NAME do env', async () => {

    const { log } = await import('../../../src/utils/logger');

    const bot = criarBotMock();



    await configureBot(bot);



    expect(bot.setMyName).toHaveBeenCalledWith({ name: expect.any(String) });

    expect(bot.setMyName.mock.calls[0][0].name.length).toBeGreaterThan(0);

    expect(bot.setMyShortDescription).toHaveBeenCalledTimes(1);

    expect(bot.setMyDescription).toHaveBeenCalledTimes(1);

    expect(log).toHaveBeenCalled();

  });



  it('não interrompe o boot quando a API do Telegram falha', async () => {

    const bot = criarBotMock();

    bot.setMyName.mockRejectedValueOnce(new Error('Telegram fora do ar'));

    bot.setMyShortDescription.mockRejectedValueOnce(new Error('Telegram fora do ar'));

    bot.setMyDescription.mockRejectedValueOnce(new Error('Telegram fora do ar'));



    await expect(configureBot(bot)).resolves.toBeUndefined();

    expect(bot.setMyShortDescription).toHaveBeenCalledTimes(1);

  });



  it('montarFotoPerfil aceita URL pública direta', () => {

    const form = montarFotoPerfil('https://exemplo.com/bot-avatar.jpg');

    expect(form).toBeInstanceOf(FormData);

    expect(form?.get('photo')).toBe('https://exemplo.com/bot-avatar.jpg');

  });



  it('PRETENDER_RESOLVE do arquivo local', () => {
    const preparado = prepararFotoPerfil('./assets/bot-avatar.jpg');
    expect(preparado).not.toBeNull();
    expect(preparado).toHaveProperty('caminhoResolvido');
  });



  it('montarFotoPerfil retorna null quando o arquivo local não existe', () => {

    expect(montarFotoPerfil('./assets/arquivo-que-nao-existe.jpg')).toBeNull();

  });



  it('sanitiza e trunca para respeitar os limites rígidos da API (120/512)', async () => {

    const { sanitizarTextoIdentidade, truncarNoLimite, DESCRICAO_CURTA, DESCRICAO_LONGA } =

      await import('../../../src/bot/setupBot');



    // Markdown/emoji removidos — a API rejeita com 400.

    expect(sanitizarTextoIdentidade('Olá *mundo* 😊\nteste')).not.toContain('*');

    expect(sanitizarTextoIdentidade('Olá *mundo* 😊\nteste')).not.toMatch(/\n/);

    // Em produção, os textos já saem dentro do limite.

    expect(sanitizarTextoIdentidade(DESCRICAO_CURTA).length).toBeLessThanOrEqual(120);

    expect(sanitizarTextoIdentidade(DESCRICAO_LONGA).length).toBeLessThanOrEqual(512);

    // Overflow vira elipse em vez de 400.

    expect(truncarNoLimite('x'.repeat(200), 120).length).toBe(120);

    expect(truncarNoLimite('x'.repeat(600), 512).length).toBe(512);

  });

});

