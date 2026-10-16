import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGlb } from '@/gfx/gltf';
import { fitVehicle, vehiclePose, vehicleTransform } from '@/vehicle/model';
import { PARKED, Vehicle, type VehicleControls, type VehicleWorld } from '@/vehicle/vehicle';
import { transformPoint } from '@/math/mat4';

const glb = readFileSync(fileURLToPath(new URL('../public/models/ambulance.glb', import.meta.url)));
const model = parseGlb(
  glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer,
);
const config = { url: '', scale: 1.4, spinPrefix: 'wheel-', steerPrefix: 'wheel-front' };
const fit = fitVehicle(model, config);

const open: VehicleWorld = { blocked: () => false, groundHeightAt: () => 0 };
const drive = (throttle: number, steer = 0): VehicleControls => ({
  throttle,
  steer,
  handbrake: false,
});

function run(vehicle: Vehicle, controls: VehicleControls, seconds: number, world = open): void {
  for (let t = 0; t < seconds; t += 1 / 60) vehicle.update(1 / 60, controls, world);
}

describe('fitVehicle', () => {
  it('measures the car off the model, in metres', () => {
    expect(fit.body.width).toBeCloseTo(1.5 * 1.4);
    expect(fit.body.length).toBeCloseTo(3.25 * 1.4);
    expect(fit.body.wheelRadius).toBeCloseTo(0.3 * 1.4);
    expect(fit.body.wheelbase).toBeCloseTo((1.01 + 0.91) * 1.4);
  });

  it('stands the model on the ground, centred on the vehicle position', () => {
    const vehicle = new Vehicle(fit.body, 100, 200, 0);
    const transform = vehicleTransform(vehicle, fit);
    const base = transformPoint(transform, fit.origin);

    expect(base.x).toBeCloseTo(100);
    expect(base.y).toBeCloseTo(0);
    expect(base.z).toBeCloseTo(200);
  });

  it('turns the model nose (+Z) onto the heading', () => {
    // Heading pi/2 faces +X.
    const vehicle = new Vehicle(fit.body, 0, 0, Math.PI / 2);
    const transform = vehicleTransform(vehicle, fit);
    const nose = transformPoint(transform, { ...fit.origin, z: fit.origin.z + 1 });

    expect(nose.x).toBeCloseTo(1.4);
    expect(nose.z).toBeCloseTo(0);
  });

  it('steers only the front wheels and leaves the body alone', () => {
    const vehicle = new Vehicle(fit.body, 0, 0, 0);
    vehicle.steer = 0.4;
    const pose = vehiclePose(vehicle, config);

    expect(pose('body')).toBeNull();
    // Wheel nose (+Z) turns toward the model's right, which is -X.
    expect(
      transformPoint(pose('wheel-front-left') ?? new Float32Array(16), { x: 0, y: 0, z: 1 }).x,
    ).toBeLessThan(0);
    expect(
      transformPoint(pose('wheel-back-left') ?? new Float32Array(16), { x: 0, y: 0, z: 1 }).x,
    ).toBeCloseTo(0);
  });
});

describe('Vehicle', () => {
  it('accelerates along its heading and tops out at max speed', () => {
    const vehicle = new Vehicle(fit.body, 0, 0, 0);
    run(vehicle, drive(1), 20);

    expect(vehicle.speed).toBeCloseTo(vehicle.handling.maxSpeed);
    expect(vehicle.z).toBeLessThan(-100);
    expect(vehicle.x).toBeCloseTo(0);
  });

  it('turns right with positive steering and cannot turn standing still', () => {
    const still = new Vehicle(fit.body, 0, 0, 0);
    run(still, drive(0, 1), 1);
    expect(still.heading).toBe(0);

    const moving = new Vehicle(fit.body, 0, 0, 0);
    run(moving, drive(0.5, 1), 2);
    expect(moving.heading).toBeGreaterThan(0.3);
    expect(moving.x).toBeGreaterThan(0);
  });

  it('brakes before reversing', () => {
    const vehicle = new Vehicle(fit.body, 0, 0, 0);
    vehicle.speed = 10;
    vehicle.update(1 / 60, drive(-1), open);

    expect(vehicle.speed).toBeCloseTo(10 - vehicle.handling.braking / 60);

    run(vehicle, drive(-1), 5);
    expect(vehicle.speed).toBeCloseTo(-vehicle.handling.maxReverseSpeed);
  });

  it('rolls to a stop when parked', () => {
    const vehicle = new Vehicle(fit.body, 0, 0, 0);
    vehicle.speed = 15;
    run(vehicle, PARKED, 3);
    expect(vehicle.speed).toBe(0);
  });

  it('stops at a wall instead of driving through it', () => {
    // A wall across the road 20 m ahead.
    const wall: VehicleWorld = {
      blocked: (_x, z, radius) => z - radius < -20,
      groundHeightAt: () => 0,
    };
    const vehicle = new Vehicle(fit.body, 0, 0, 0);
    run(vehicle, drive(1), 10, wall);

    expect(vehicle.z - fit.body.length / 2).toBeGreaterThanOrEqual(-20 - 1e-6);
    expect(Math.abs(vehicle.speed)).toBeLessThan(vehicle.handling.maxSpeed);
  });

  it('reverses out after driving into a wall at an angle', () => {
    // A building face along x = 0, the car angled into it from the right.
    const wall: VehicleWorld = {
      blocked: (x, _z, radius) => x - radius < 0,
      groundHeightAt: () => 0,
    };
    const vehicle = new Vehicle(fit.body, 3, 0, -0.6);
    run(vehicle, drive(1), 3, wall);
    const stuck = { x: vehicle.x, z: vehicle.z };

    run(vehicle, drive(-1), 2, wall);
    expect(Math.hypot(vehicle.x - stuck.x, vehicle.z - stuck.z)).toBeGreaterThan(3);
  });

  it('rolls the wheels by distance over radius', () => {
    const vehicle = new Vehicle(fit.body, 0, 0, 0);
    vehicle.speed = 6;
    vehicle.update(0.5, drive(0.24), open);
    expect(vehicle.wheelSpin).toBeCloseTo(
      Math.hypot(vehicle.x, vehicle.z) / fit.body.wheelRadius,
      2,
    );
  });
});
