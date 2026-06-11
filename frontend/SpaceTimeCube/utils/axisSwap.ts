import type { Point3D } from '../types';

export function swapPointXY(point: Point3D): Point3D {
  return [point[1], point[0], point[2]];
}

export function swapHeadingForSwappedXY(heading: number): number {
  const swappedHeading = Math.PI / 2 - heading;
  return Math.atan2(Math.sin(swappedHeading), Math.cos(swappedHeading));
}
