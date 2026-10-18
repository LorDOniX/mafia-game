import { describe, expect, it } from 'vitest';
import { engine } from '@/ui/speedometer';

describe('engine', () => {
  it('idles in neutral at a standstill', () => {
    expect(engine(0)).toEqual({ gear: 'N', rpm: 800 });
  });

  it('shows reverse when rolling backwards', () => {
    expect(engine(-10).gear).toBe('R');
  });

  it('shifts up as the car speeds up, dropping the revs at each change', () => {
    const before = engine(24);
    const after = engine(27);
    expect(before.gear).toBe('1');
    expect(after.gear).toBe('2');
    expect(after.rpm).toBeLessThan(before.rpm);
    expect(engine(80).gear).toBe('4');
  });

  it('never revs past the dial', () => {
    for (let kmh = -40; kmh <= 300; kmh += 5) {
      const { rpm } = engine(kmh);
      expect(rpm).toBeGreaterThanOrEqual(800);
      expect(rpm).toBeLessThanOrEqual(8000);
    }
  });
});
