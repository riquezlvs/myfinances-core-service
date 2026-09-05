type LogContext = Record<string, unknown>;

export function log(level: 'info' | 'warn' | 'error', message: string, context: LogContext = {}) {
  const timestamp = new Date().toISOString();
  const meta = Object.entries(context)
    .map(([chave, valor]) => `${chave}=${typeof valor === 'string' ? valor : JSON.stringify(valor)}`)
    .join(' ');
  const linha = `[${timestamp}] [${level.toUpperCase()}] ${message}${meta ? ` | ${meta}` : ''}`;

  if (level === 'error') console.error(linha);
  else if (level === 'warn') console.warn(linha);
  else console.log(linha);
}

export async function withTiming<T>(
  label: string,
  context: LogContext,
  fn: () => Promise<T>
): Promise<T> {
  const inicio = Date.now();
  log('info', `⏳ Iniciando: ${label}`, context);
  try {
    const resultado = await fn();
    log('info', `✅ Concluído: ${label}`, { ...context, duracao_ms: Date.now() - inicio });
    return resultado;
  } catch (err) {
    log('error', `❌ Falhou: ${label}`, {
      ...context,
      duracao_ms: Date.now() - inicio,
      erro: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}