import './styles.css';
import { App } from './app';

function fatal(root: HTMLElement, title: string, detail: string): void {
  root.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'fatal';
  const h = document.createElement('div');
  h.className = 'fatal-title';
  h.textContent = title;
  const p = document.createElement('div');
  p.className = 'fatal-text';
  p.textContent = detail;
  box.append(h, p);
  root.appendChild(box);
}

const root = document.getElementById('app');
if (root) {
  try {
    new App(root);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const gl = /webgl|context/i.test(msg);
    fatal(
      root,
      gl ? 'Graphics are not available' : 'HOLDFAST could not start',
      gl
        ? 'This browser could not start WebGL. Try Chrome or Safari, make sure hardware acceleration is on, and reload.'
        : msg,
    );
  }
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
