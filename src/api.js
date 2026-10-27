// Only the preview build sets this variable. Self-hosting always uses same-origin.
const base = import.meta.env.VITE_API_BASE || '';
export function endpoint(path) {
  return new URL(`${base}${path}`, window.location.href.split('#')[0]).href;
}
export async function api(path, body) {
  const response = await fetch(endpoint(path), {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Please check your details and try again.');
  }
  return data;
}
export function socketURL(room) {
  return endpoint(`/ws/${room}`).replace(/^http/, 'ws');
}
export function roomFromInput(input) {
  const value = input.trim();
  const raw = value.includes('#/room/') ? value.split('#/room/')[1] : value;
  return raw.split(/[?&/]/)[0].toLowerCase();
}
export function inviteURL(room) {
  return `${window.location.href.split('#')[0]}#/room/${room}`;
}
