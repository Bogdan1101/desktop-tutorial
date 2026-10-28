// Node: голое имя 'three' → vendor/three.module.min.js (в браузере это делает importmap в index.html).
// Формат указан явно: без "type": "module" в package.json Node иначе гадает и предупреждает.
export async function resolve(specifier, context, next) {
  if (specifier === 'three') {
    return { url: new URL('../vendor/three.module.min.js', import.meta.url).href, format: 'module', shortCircuit: true };
  }
  return next(specifier, context);
}

// Код игры и vendor/*.js — ES-модули, как и в браузере
const ROOTS = ['../src/', '../vendor/'].map((p) => new URL(p, import.meta.url).href);
export async function load(url, context, next) {
  if (url.endsWith('.js') && ROOTS.some((r) => url.startsWith(r))) return next(url, { ...context, format: 'module' });
  return next(url, context);
}
