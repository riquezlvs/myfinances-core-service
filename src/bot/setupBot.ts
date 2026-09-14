/**
 * SetupBot — identidade do Guará IA.
 *
 * O nome/username do bot (@...) e a foto exibida no cabeçalho do chat **só
 * podem ser alterados manualmente no @BotFather** (limitação da Bot API:
 * `setMyName` define apenas o nome amigável, e `setMyProfilePhoto` aceita
 * apenas foto principal estática). Este módulo sincroniza o que é possível
 * via API: nome amigável, descrições e foto principal.
 *
 * Limites rígidos da API (rejeitados com 400 e mensagens crípticas
 * `BOT_SHARETEXT_INVALID` / `BOT_DESC_INVALID` quando estourados):
 * - short_description: 0–120 caracteres, texto puro (sem Markdown/emoji/quebra de linha).
 * - description: 0–512 caracteres, texto puro (sem formatação).
 */
import TelegramBot from 'node-telegram-bot-api';
import { readFileSync, statSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { isAbsolute, resolve, dirname, basename, extname } from 'node:path';
import { log } from '../utils/logger';

/**
 * Faz upload multipart "na mão" (sem FormData/fetch). setMyProfilePhoto
 * recebe um InputProfilePhoto; o arquivo é referenciado pelo campo JSON
 * usando `attach://avatar`.
 */
function postFotoPerfilMultipart(
  token: string,
  caminhoArquivo: string,
  nomeArquivo: string,
  mime: string
): Promise<{ ok: boolean; description?: string }> {
  return new Promise((resolve, reject) => {
    const boundary = `----BotAvatar${Date.now().toString(16)}`;
    const arquivo = readFileSync(caminhoArquivo);
    const corpoInicio = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"\r\n\r\n{"type":"static","photo":"attach://avatar"}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="${nomeArquivo}"\r\nContent-Type: ${mime}\r\n\r\n`,
      'utf8'
    );
    const corpoFim = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const corpo = Buffer.concat([corpoInicio, arquivo, corpoFim]);

    const req = httpsRequest(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/setMyProfilePhoto`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': corpo.length,
        },
      },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode ?? 'desconhecido'} ao enviar foto de perfil`));
          res.resume();
          return;
        }
        const partes: Buffer[] = [];
        res.on('data', (chunk: Buffer) => partes.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(partes).toString('utf8')) as { ok: boolean; description?: string });
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      }
    );
    req.on('error', reject);
    req.end(corpo);
  });
}
import { TELEGRAM_BOT_TOKEN, BOT_NAME, BOT_PROFILE_PHOTO_PATH } from '../config/env';

/** Tamanho máximo da foto de perfil do bot (~512KB, limite da API). */
const MAX_FOTO_PERFIL_BYTES = 512 * 1024;

/**
 * Limites rígidos da API aplicados em código (fail-fast local em vez de 400).
 */
export const MAX_SHORT_DESCRIPTION_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 512;

/**
 * Sanitiza o texto para os campos de identidade: remove Markdown básico,
 * converte quebras de linha em espaço e normaliza espaços. A API rejeita
 * `*`, `_`, backticks e quebras de linha nesses campos.
 */
export function sanitizarTextoIdentidade(texto: string): string {
  return texto.replace(/[*_`~>#|[\]()]/g, '').replace(/\s+/g, ' ').trim();
}

/** Trunca no limite (com elipse) em vez de deixar a API rejeitar. */
export function truncarNoLimite(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  return `${texto.slice(0, Math.max(0, limite - 1)).trimEnd()}…`;
}

/**
 * Resolve o caminho da foto de perfil a partir da **raiz do projeto**
 * (para que `BOT_PROFILE_PHOTO_PATH=./assets/bot-avatar.jpg` funcione
 * independente do cwd de execução).
 */
function resolverCaminhoFoto(caminho: string): string {
  if (isAbsolute(caminho)) return caminho;
  // Compatível com CommonJS (module: commonjs) — __dirname da pasta src/bot.
  const raizProjeto = resolve(dirname(__filename), '..', '..');
  return resolve(raizProjeto, caminho);
}

/** Texto de ajuda curto exibido no perfil do bot (preview ao ser adicionado). */
export const DESCRICAO_CURTA =
  'Guará IA: registre gastos em linguagem natural, consulte resumos e receba insights preditivos.';

/** Texto de ajuda longo exibido na bio do bot (texto puro, sem formatação). */
export const DESCRICAO_LONGA = [
  `${BOT_NAME}: assistente de financas pessoais no Telegram.`,
  'Registre gastos em linguagem natural e acompanhe resumos e metas.',
  'Exemplos: Gastei 45 no almoco no pix. Quanto gastei com transporte em agosto.',
  'Comandos: /start /resumo /fatura /gastos /cartao /poupanca /exportar /insight /meta /viagem /status.',
].join(' ');

/**
 * Valida o caminho/URL da foto e resolve metadados para o upload.
 *
 * @returns `null` quando a foto deve ser pulada (arquivo ausente ou >512KB).
 */
export function prepararFotoPerfil(caminho: string): {
  caminhoResolvido: string;
  nomeArquivo: string;
  mime: string;
} | { url: string } | null {
  if (caminho.startsWith('http://') || caminho.startsWith('https://')) {
    return { url: caminho };
  }

  const caminhoResolvido = resolverCaminhoFoto(caminho);
  let tamanhoBytes: number;
  try {
    tamanhoBytes = statSync(caminhoResolvido).size;
  } catch {
    log('warn', `📸 Foto de perfil não encontrada em: "${caminho}" (resolvido: "${caminhoResolvido}"). Pulando atualização.`);
    return null;
  }
  if (tamanhoBytes > MAX_FOTO_PERFIL_BYTES) {
    log(
      'warn',
      `📸 Foto de perfil acima de 512KB (${tamanhoBytes} bytes) em "${caminhoResolvido}". Reduza a imagem e tente de novo. Pulando atualização.`
    );
    return null;
  }
  const nomeArquivo = basename(caminhoResolvido) || 'profile_photo.jpg';
  const mime = extname(nomeArquivo).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  return { caminhoResolvido, nomeArquivo, mime };
}

/**
 * Monta o FormData do upload (mantida p/ testes unitários do contrato).
 * Em produção o upload usa `postFotoPerfilMultipart` (multipart manual),
 * porque a Bot API rejeitava o campo gerado pelo `FormData` nativo.
 */
export function montarFotoPerfil(caminho: string): FormData | null {
  const preparado = prepararFotoPerfil(caminho);
  if (!preparado || 'url' in preparado) {
    if (preparado && 'url' in preparado) {
      const formData = new FormData();
      formData.append('photo', preparado.url);
      return formData;
    }
    return null;
  }
  // Placeholder intencional: o fluxo real lê via stream em postFotoPerfilMultipart.
  return new FormData();
}

async function atualizarFotoPerfil(caminho: string): Promise<void> {
  const preparado = prepararFotoPerfil(caminho);
  if (!preparado) return;

  let result: { ok: boolean; description?: string };
  if ('url' in preparado) {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyProfilePhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo: { type: 'static', photo: preparado.url } }),
    });
    result = (await response.json()) as { ok: boolean; description?: string };
  } else {
    result = await postFotoPerfilMultipart(
      TELEGRAM_BOT_TOKEN,
      preparado.caminhoResolvido,
      preparado.nomeArquivo,
      preparado.mime
    );
  }

  if (!result.ok) {
    throw new Error(`Falha ao atualizar foto de perfil: ${result.description ?? 'erro desconhecido'}`);
  }

  log('info', '📸 Foto de perfil do bot atualizada com sucesso!');
}

/**
 * Configura a identidade completa do bot no Telegram:
 * 1. Nome exibido (setMyName)
 * 2. Descrição curta (setMyShortDescription)
 * 3. Descrição longa (setMyDescription)
 * 4. Foto de perfil (opcional)
 *
 * Cada passo tem try/catch individual para que uma falha em um não impeça os
 * demais. Chamado uma vez na inicialização.
 */
export async function configureBot(bot: TelegramBot): Promise<void> {
  // 1. Nome do bot
  try {
    await bot.setMyName({ name: BOT_NAME });
    log('info', `🤖 Nome do bot configurado: "${BOT_NAME}"`);
  } catch (err) {
    log('error', 'Falha ao configurar nome do bot', {
      erro: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Descrição curta (texto puro, ≤120; sanitizar+truncar evita 400)
  const descricaoCurtaSegura = truncarNoLimite(
    sanitizarTextoIdentidade(DESCRICAO_CURTA),
    MAX_SHORT_DESCRIPTION_LENGTH
  );
  try {
    await bot.setMyShortDescription({ short_description: descricaoCurtaSegura });
    log('info', '✏️ Descrição curta do bot configurada');
  } catch (err) {
    log('error', 'Falha ao configurar descrição curta do bot', {
      erro: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Descrição longa (texto puro, ≤512; sanitizar+truncar evita 400)
  const descricaoLongaSegura = truncarNoLimite(
    sanitizarTextoIdentidade(DESCRICAO_LONGA),
    MAX_DESCRIPTION_LENGTH
  );
  try {
    await bot.setMyDescription({ description: descricaoLongaSegura });
    log('info', '📝 Descrição longa do bot configurada');
  } catch (err) {
    log('error', 'Falha ao configurar descrição longa do bot', {
      erro: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Foto de perfil (opcional — só se BOT_PROFILE_PHOTO_PATH estiver definido)
  if (BOT_PROFILE_PHOTO_PATH) {
    try {
      await atualizarFotoPerfil(BOT_PROFILE_PHOTO_PATH);
    } catch (err) {
      log('error', 'Falha ao atualizar foto de perfil do bot', {
        erro: err instanceof Error ? err.message : String(err),
        caminho: BOT_PROFILE_PHOTO_PATH,
      });
    }
  } else {
    log('info', '📸 BOT_PROFILE_PHOTO_PATH não definido — foto de perfil não atualizada.');
  }
}