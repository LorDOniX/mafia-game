import { describe, expect, it } from 'vitest';
import { generateCity } from '@/city/layout';
import { CityCollision } from '@/city/collision';
import { createRng } from '@/core/rng';
import { Body } from '@/people/body';
import { Gangster, type Target } from '@/people/gangster';
import { Pistol, MAGAZINE } from '@/game/pistol';
import { DEFAULT_GANG_WAR, GangWar, makeDistricts, POINTS } from '@/game/gangwar';

const layout = generateCity();
const world = new CityCollision(layout);
const spawn = Math.floor(layout.config.gridSize / 2) * layout.pitch;

describe('CityCollision.raycast', () => {
  it('stops at a building and passes down an empty street', () => {
    const building = layout.buildings[0];
    if (!building) throw new Error('no buildings');
    const f = building.footprint;
    const origin = { x: f.minX - 5, y: 1.5, z: (f.minZ + f.maxZ) / 2 };
    expect(world.raycast(origin, { x: 1, y: 0, z: 0 }, 50)).toBeCloseTo(5, 0);

    const street = { x: spawn, y: 1.5, z: spawn };
    expect(world.raycast(street, { x: 0, y: 0, z: 1 }, 30)).toBe(30);
  });
});

describe('Body.hitBy', () => {
  const body = new Body();
  body.x = 10;
  body.z = 0;

  it('tells a head shot from a body shot', () => {
    expect(body.hitBy({ x: 0, y: 1.55, z: 0 }, { x: 1, y: 0, z: 0 }, 50)?.head).toBe(true);
    const chest = body.hitBy({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 50);
    expect(chest?.head).toBe(false);
    expect(chest?.distance).toBeCloseTo(10 - 0.33, 2);
  });

  it('misses past the shoulder and over the head, and ignores the dead', () => {
    expect(body.hitBy({ x: 0, y: 1, z: 1 }, { x: 1, y: 0, z: 0 }, 50)).toBeNull();
    expect(body.hitBy({ x: 0, y: 2.2, z: 0 }, { x: 1, y: 0, z: 0 }, 50)).toBeNull();
    const dead = new Body();
    dead.x = 10;
    dead.die();
    expect(dead.hitBy({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 50)).toBeNull();
  });
});

describe('Pistol', () => {
  it('fires a magazine, then reloads before it fires again', () => {
    const pistol = new Pistol();
    let shots = 0;
    for (let t = 0; t < 3; t += 0.05) {
      pistol.update(0.05);
      if (pistol.trigger()) shots++;
      if (shots === MAGAZINE) break;
    }
    expect(shots).toBe(MAGAZINE);
    expect(pistol.reloading).toBe(true);
    expect(pistol.trigger()).toBe(false);
    for (let t = 0; t < 2; t += 0.05) pistol.update(0.05);
    expect(pistol.magazine).toBe(MAGAZINE);
  });
});

describe('Gangster', () => {
  const block = layout.blocks.find((b) => !b.isPlaza);
  if (!block) throw new Error('no built block');

  it('spots a player in plain view, turns and opens fire', () => {
    const rng = createRng(1);
    const gangster = new Gangster(block.sidewalk, block.plot, rng, world);
    const { x, z } = gangster.body;
    // Standing on the same sidewalk, a few metres off.
    const player: Target = {
      position: { x: x + 0.01, y: 1.7, z: z + 6 },
      alive: true,
      inCar: false,
    };
    let shots = 0;
    for (let t = 0; t < 5; t += 1 / 30) {
      player.position = { x: gangster.body.x, y: 1.7, z: gangster.body.z + 6 };
      if (gangster.update(1 / 30, player, world, rng)) shots++;
    }
    expect(gangster.state).toBe('combat');
    expect(shots).toBeGreaterThan(1);
  });

  it('dies after enough hits and stays down', () => {
    const gangster = new Gangster(block.sidewalk, block.plot, createRng(2), world);
    expect(gangster.damage(40)).toBe(false);
    expect(gangster.damage(40)).toBe(false);
    expect(gangster.damage(40)).toBe(true);
    expect(gangster.alive).toBe(false);
    expect(gangster.damage(40)).toBe(false);
  });
});

describe('GangWar', () => {
  const options = { ...DEFAULT_GANG_WAR, safe: { x: spawn, z: spawn } };

  it('splits the city into districts and gangs up in some, away from the start', () => {
    expect(makeDistricts(layout, 2)).toHaveLength(16);
    const war = new GangWar(layout, options, world, createRng(3));
    expect(war.contested).toBe(DEFAULT_GANG_WAR.held);
    for (const d of war.districts.filter((x) => x.contested)) {
      expect(d.gangsters.length).toBeGreaterThanOrEqual(DEFAULT_GANG_WAR.gangstersPerDistrict.min);
      const holdsSpawn =
        spawn > d.bounds.minX &&
        spawn < d.bounds.maxX &&
        spawn > d.bounds.minZ &&
        spawn < d.bounds.maxZ;
      expect(holdsSpawn).toBe(false);
    }
  });

  it('scores kills and head shots, and takes a district once it is cleared', () => {
    const war = new GangWar(layout, options, world, createRng(4));
    const district = war.districts.find((d) => d.contested);
    if (!district) throw new Error('no gang district');
    const open = (max: number): number => max;

    district.gangsters.forEach((g, i) => {
      const { x, z } = g.body;
      const y = i === 0 ? 1.55 : 1;
      // Point blank, three body shots or one to the head.
      for (let s = 0; s < 3 && g.alive; s++) {
        war.shoot({ x: x - 3, y, z }, { x: 1, y: 0, z: 0 }, open);
      }
    });

    expect(district.captured).toBe(true);
    const kills = district.gangsters.length;
    expect(war.score).toBe(kills * POINTS.kill + POINTS.headshot + POINTS.district);
    expect(war.events.some((e) => e.text === 'District taken')).toBe(true);
  });

  it('does not shoot through walls', () => {
    const war = new GangWar(layout, options, world, createRng(5));
    const target = war.gangsters[0];
    if (!target) throw new Error('no gangster');
    const { x, z } = target.body;
    const result = war.shoot({ x: x - 3, y: 1, z }, { x: 1, y: 0, z: 0 }, () => 1);
    expect(result.gangster).toBeNull();
    expect(target.alive).toBe(true);
  });

  it('hurts the player under fire, heals after a lull, and respawns at full health', () => {
    const war = new GangWar(layout, options, world, createRng(6));
    const gangster = war.gangsters[0];
    if (!gangster) throw new Error('no gangster');
    const rng = createRng(7);
    const player: Target = { position: { x: 0, y: 1.7, z: 0 }, alive: true, inCar: false };
    for (let t = 0; t < 20 && war.health === 100; t += 1 / 30) {
      player.position = { x: gangster.body.x, y: 1.7, z: gangster.body.z + 5 };
      war.update(1 / 30, player, world, rng);
    }
    expect(war.health).toBeLessThan(100);

    const hurt = war.health;
    player.alive = false;
    for (let t = 0; t < 10; t += 1 / 30) war.update(1 / 30, player, world, rng);
    expect(war.health).toBeGreaterThan(hurt);

    war.respawn();
    expect(war.health).toBe(100);
  });
});
