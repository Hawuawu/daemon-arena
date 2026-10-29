import { describe, expect, it } from 'vitest';
import { CoreLoadError, parseMeta } from '../../src/runtime/sandbox';

describe('parseMeta', () => {
  it('reads every supported `// @key value` header', () => {
    const src = '// @name X-1\n// @author me\n// @version 1.2\n// @color #abc\n// @description Does things.\nfunction tick() {}';
    expect(parseMeta(src)).toEqual({ name: 'X-1', author: 'me', version: '1.2', color: '#abc', description: 'Does things.' });
  });

  it('tolerates indentation and extra whitespace, and trims values', () => {
    expect(parseMeta('   //   @name    SPACED OUT   \n').name).toBe('SPACED OUT');
  });

  it('keeps the first occurrence of a key and ignores unknown keys', () => {
    expect(parseMeta('// @name FIRST\n// @name SECOND\n// @evil yes')).toEqual({ name: 'FIRST' });
  });

  it('truncates the name to 24 characters and other values to 200', () => {
    const meta = parseMeta(`// @name ${'N'.repeat(40)}\n// @description ${'d'.repeat(300)}`);
    expect(meta.name).toHaveLength(24);
    expect(meta.description).toHaveLength(200);
  });

  it.each(['#abc', '#a1b2c3', '#a1b2c3d4'])('accepts hex colour %s', (color) => {
    expect(parseMeta(`// @name X\n// @color ${color}`).color).toBe(color);
  });

  it.each(['red', '#12', 'red;background:url(x)', '#abc def'])('drops unsafe or non-hex colour %j', (color) => {
    expect(parseMeta(`// @name X\n// @color ${color}`).color).toBeUndefined();
  });

  it('requires @name', () => {
    expect(() => parseMeta('function tick() {}')).toThrow(CoreLoadError);
    expect(() => parseMeta('function tick() {}')).toThrow(/@name/);
  });

  it('never executes the script', () => {
    expect(parseMeta('// @name SAFE\nthrow new Error("ran")').name).toBe('SAFE');
  });
});
