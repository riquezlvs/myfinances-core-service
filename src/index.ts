import 'dotenv/config';
import http from 'http';
import { iniciarBot } from './bot';
import { log } from './utils/logger';

async function main(): Promise<void> {
  const porta = Number(process.env.PORT || 3000);
  const servidorHealthcheck = http.createServer((requisicao, resposta) => {
    if (requisicao.method === 'GET' || requisicao.method === 'HEAD') {
      resposta.writeHead(200, { 'Content-Type': 'text/plain' });
      resposta.end(requisicao.method === 'HEAD' ? undefined : 'Guará Online');
      return;
    }

    resposta.writeHead(405, { 'Content-Type': 'text/plain' });
    resposta.end('Método não permitido');
  });

  await new Promise<void>((resolve, reject) => {
    servidorHealthcheck.once('error', reject);
    servidorHealthcheck.listen(porta, () => {
      servidorHealthcheck.removeListener('error', reject);
      resolve();
    });
  });
  log('info', `Servidor de healthcheck HTTP ativo na porta ${porta}`);

  const { shutdown } = await iniciarBot();

  // Fase 6 — Graceful shutdown: SIGINT (Ctrl+C) e SIGTERM (docker stop,
  // kill) param os crons e o polling do Telegram sem processos órfãos.
  const encerrar = (sinal: string): void => {
    log('info', `📡 Sinal ${sinal} recebido — iniciando shutdown...`);
    void shutdown().then(
      () =>
        new Promise<void>((resolve) => {
          servidorHealthcheck.close(() => resolve());
        })
    ).then(() => process.exit(0));
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