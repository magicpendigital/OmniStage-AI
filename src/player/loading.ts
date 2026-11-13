/**
 * Phase 10B — counts asset loads in flight (GLB models, HDRIs, 2D images) so frame-stepped capture (MP4 export) can
 * wait until a scene is fully dressed before it records the first frame.
 */
let pending = 0;

export function trackLoad<T>(promise: Promise<T>): Promise<T> {
  pending++;
  const done = () => {
    pending = Math.max(0, pending - 1);
  };
  promise.then(done, done);
  return promise;
}

export function trackImage(img: HTMLImageElement) {
  if (img.complete) return;
  pending++;
  const done = () => {
    pending = Math.max(0, pending - 1);
    img.removeEventListener('load', done);
    img.removeEventListener('error', done);
  };
  img.addEventListener('load', done);
  img.addEventListener('error', done);
}

export function pendingLoads() {
  return pending;
}
