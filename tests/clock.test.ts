import { describe, expect, it } from 'vitest';
import { DAY_LENGTH_SECONDS, daylightAt, GameClock } from '@/game/clock';

describe('GameClock', () => {
  it('starts at seven in the morning on day one', () => {
    const clock = new GameClock();
    expect(clock.label()).toBe('07:00');
    expect(clock.day).toBe(1);
  });

  it('runs a whole day in five minutes', () => {
    expect(DAY_LENGTH_SECONDS).toBe(300);
    const clock = new GameClock();
    clock.advance(DAY_LENGTH_SECONDS / 4);
    expect(clock.label()).toBe('13:00');
    clock.advance((DAY_LENGTH_SECONDS * 3) / 4);
    expect(clock.label()).toBe('07:00');
    expect(clock.day).toBe(2);
  });

  it('skips forward to the next time it reads a given hour', () => {
    const clock = new GameClock();
    clock.skipTo(21);
    expect(clock.label()).toBe('21:00');
    clock.skipTo(7);
    expect(clock.label()).toBe('07:00');
    expect(clock.day).toBe(2);
  });
});

describe('daylightAt', () => {
  it('is full day at noon and full night at midnight', () => {
    expect(daylightAt(12)).toEqual({ daylight: 1, dusk: 0, lights: 0 });
    expect(daylightAt(0).daylight).toBe(0);
    expect(daylightAt(0).lights).toBe(1);
  });

  it('fades through dusk instead of switching', () => {
    let previous = daylightAt(16).daylight;
    let steps = 0;
    for (let hour = 16; hour <= 20; hour += 0.05) {
      const { daylight } = daylightAt(hour);
      expect(daylight).toBeLessThanOrEqual(previous + 1e-9);
      // Žádný skok mezi snímky vzdálenými od sebe dvacetinu hodiny.
      expect(previous - daylight).toBeLessThan(0.1);
      if (daylight > 0.01 && daylight < 0.99) steps++;
      previous = daylight;
    }
    // Rozloženo na více než hodinu herního času.
    expect(steps).toBeGreaterThan(20);
  });

  it('glows at sunset and turns the lamps on as the light goes', () => {
    expect(daylightAt(18).dusk).toBeGreaterThan(0.8);
    expect(daylightAt(18).lights).toBeGreaterThan(0.5);
    expect(daylightAt(15).lights).toBe(0);
  });
});
