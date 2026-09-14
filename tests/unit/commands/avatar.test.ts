import { describe, it, expect } from 'vitest';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

const AVATAR_PATH = resolve(__dirname, '..', '..', '..', 'assets', 'bot-avatar.jpg');

describe('assets — bot-avatar.jpg (identidade Guará IA)', () => {
  it('existe e respeita o limite de 512KB da Bot API', () => {
    const { size } = statSync(AVATAR_PATH);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(512 * 1024);
  });
});
