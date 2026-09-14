// Gera assets/bot-avatar.jpg — placeholder oficial da identidade "Guará IA".
// Uso: node scripts/gerar-avatar-bot.cjs
// Não commitar binários duplicados: rode uma vez por máquina; o .jpg
// resultante é o arquivo de referência (a imagem real pode substituí-lo).
const { mkdirSync, writeFileSync, statSync } = require('node:fs');
const { dirname, join } = require('node:path');

async function main() {
  const { createCanvas } = await import('@napi-rs/canvas');
  const TAM = 512;
  const canvas = createCanvas(TAM, TAM);
  const ctx = canvas.getContext('2d');

  // Fundo: gradiente verde-escuro -> dourado (identidade "Guará").
  const grad = ctx.createLinearGradient(0, 0, TAM, TAM);
  grad.addColorStop(0, '#0e4d2e');
  grad.addColorStop(1, '#c9922e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TAM, TAM);

  // Círculo central claro.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(TAM / 2, TAM / 2 - 20, 150, 0, Math.PI * 2);
  ctx.fill();

  // Moeda estilizada (cifrão) — símbolo de finanças.
  ctx.fillStyle = '#0e4d2e';
  ctx.font = 'bold 190px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', TAM / 2, TAM / 2 - 10);

  // Faixa inferior com o nome do bot.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, TAM - 120, TAM, 120);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px sans-serif';
  ctx.fillText('Guará IA', TAM / 2, TAM - 58);

  const outDir = join(__dirname, '..', 'assets');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'bot-avatar.jpg');
  const jpeg = await canvas.encode('jpeg', 90);
  writeFileSync(out, Buffer.from(jpeg));
  const { size } = statSync(out);
  console.log(`OK: ${out} (${size} bytes)`);
}

main().catch((err) => {
  console.error('Falha ao gerar avatar:', err instanceof Error ? err.message : err);
  process.exit(1);
});
