import { describe, expect, it } from 'vitest';
import { validateAction } from '../../src/engine/match';

describe('validateAction', () => {
  describe('accepts', () => {
    it.each([
      ['null as idle', null, { type: 'idle' }],
      ['undefined as idle', undefined, { type: 'idle' }],
      ['idle', { type: 'idle' }, { type: 'idle' }],
      ['move with default throttle 1', { type: 'move', heading: 1 }, { type: 'move', heading: 1, throttle: 1 }],
      ['move with throttle clamped to 1', { type: 'move', heading: 1, throttle: 5 }, { type: 'move', heading: 1, throttle: 1 }],
      ['move with throttle clamped to 0', { type: 'move', heading: 1, throttle: -2 }, { type: 'move', heading: 1, throttle: 0 }],
      ['attack', { type: 'attack', heading: -3 }, { type: 'attack', heading: -3 }],
      ['evade without heading', { type: 'evade' }, { type: 'evade', heading: undefined }],
      ['evade with heading', { type: 'evade', heading: 2 }, { type: 'evade', heading: 2 }],
    ])('%s', (_label, raw, expected) => {
      expect(validateAction(raw)).toEqual(expected);
    });

    it('drops unknown extra fields', () => {
      expect(validateAction({ type: 'attack', heading: 0, damage: 999 })).toEqual({ type: 'attack', heading: 0 });
    });
  });

  describe('rejects', () => {
    it.each([
      ['a string', 'attack'],
      ['a number', 1],
      ['an unknown type', { type: 'teleport', x: 0, y: 0 }],
      ['a missing type', { heading: 1 }],
      ['move without heading', { type: 'move' }],
      ['move with NaN heading', { type: 'move', heading: NaN }],
      ['move with string throttle', { type: 'move', heading: 0, throttle: 'full' }],
      ['attack with Infinity heading', { type: 'attack', heading: Infinity }],
      ['attack with string heading', { type: 'attack', heading: '1' }],
      ['evade with non-numeric heading', { type: 'evade', heading: null }],
    ])('%s', (_label, raw) => {
      expect(validateAction(raw)).toBeNull();
    });
  });
});
