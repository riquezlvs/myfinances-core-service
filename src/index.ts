import 'dotenv/config';
import http from 'http';
import { iniciarBot } from './bot';
import { log } from './utils/logger';

import { handleApiRequest } from './api/routes';

async function main(): Promise<void> {
  const porta = Number(process.env.PORT || 3001);
  const servidorHttp = http.createServer(async (requisicao, resposta) => {
    const metodo = requisicao.method ?? 'GET';
    const url = requisicao.url ?? '/';

    // Log para auditoria de tráfego HTTP
    if (metodo !== 'HEAD') {
      log('info', `🌐 Requisição HTTP recebida: ${metodo} ${url}`);
    }

    // Tenta resolver pela API REST (CORS, /api/chat, /api/dashboard)
    const tratouApi = await handleApiRequest(requisicao, resposta);
    if (tratouApi) return;

    if (metodo === 'GET' || metodo === 'HEAD') {
      resposta.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      resposta.end(
        metodo === 'HEAD'
          ? undefined
          : 'Guará IA Online 🚀 Backend e API ativos. Pronto para atender Telegram e Web.'
      );
      return;
    }

    resposta.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    resposta.end('Método não permitido.');
  });

  await new Promise<void>((resolve, reject) => {
    servidorHttp.once('error', reject);
    servidorHttp.listen(porta, () => {
      servidorHttp.removeListener('error', reject);
      resolve();
    });
  });
  log('info', `Servidor HTTP & API ativo na porta ${porta}`);

  const { shutdown } = await iniciarBot();

  // Fase 6 — Graceful shutdown: SIGINT (Ctrl+C) e SIGTERM (docker stop,
  // kill) param os crons e o polling do Telegram sem processos órfãos.
  const encerrar = (sinal: string): void => {
    log('info', `📡 Sinal ${sinal} recebido — iniciando shutdown...`);
    void shutdown().then(
      () =>
        new Promise<void>((resolve) => {
          servidorHttp.close(() => resolve());
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