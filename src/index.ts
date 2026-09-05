import 'dotenv/config';
import { iniciarBot } from './bot';
import { log } from './utils/logger';

async function main(): Promise<void> {
  await iniciarBot();
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