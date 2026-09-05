import 'dotenv/config';
import { iniciarBot } from './bot';
import { log } from './utils/logger';

async function main(): Promise<void> {
  const { shutdown } = await iniciarBot();

  // Fase 6 — Graceful shutdown: SIGINT (Ctrl+C) e SIGTERM (docker stop,
  // kill) param os crons e o polling do Telegram sem processos órfãos.
  const encerrar = (sinal: string): void => {
    log('info', `📡 Sinal ${sinal} recebido — iniciando shutdown...`);
    void shutdown().then(() => process.exit(0));
  };

  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));

  // Defesa em profundidade: promises rejeitadas não tratadas (ex: um
  // bot.sendMessage dentro de um catch) são logadas em vez de derrubar o
  // processo silenciosamente (unhandledRejection).
  process.on('unhandledRejection', (reason) => {
    log('error', '💥 Promise rejeitada não tratada', {
      erro: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

// Guard de segurança para os testes (Vitest): este arquivo só dispara o
// bot de verdade quando executado diretamente (`node dist/index.js` /
// `tsx src/index.ts`), nunca quando é importado por um arquivo de teste.
if (require.main === module) {
  main().catch((err) => {
    log('error', '💥 Falha fatal ao iniciar o bot', {
      erro: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}

export { main };