import { devkitTarget } from './generated/devkit-target.js';

export function appUrl(path) {
  if (!path) {
    return '/';
  }

  if (devkitTarget.features.baseUrl && devkitTarget.features.proxy) {
    return `/proxy/${path}`;
  }

  return `/${path}`;
}
