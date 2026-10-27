import { test, expect } from '@playwright/test';

const instrument = () => {
  const Native = window.RTCPeerConnection;
  window.__testPeers = [];
  window.RTCPeerConnection = class extends Native {
    constructor(...args) { super(...args); window.__testPeers.push(this); }
  };
};

async function createRoom(page, withMedia = true) {
  await page.goto('/');
  await page.getByRole('button', { name: "I'm a professor" }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Alex Morgan');
  if (withMedia) {
    await page.getByRole('button', { name: 'Enable both', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mute microphone' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Start a meeting', exact: true }).click();
  await expect(page.getByText('In meeting', { exact: true })).toBeVisible();
  return page.url();
}

async function mediaReceived(page) {
  await expect.poll(async () => page.evaluate(async () => {
    const pc = window.__testPeers.find(p => p.connectionState === 'connected');
    if (!pc) return false;
    const stats = [...(await pc.getStats()).values()].filter(s => s.type === 'inbound-rtp');
    return stats.some(s => s.kind === 'audio' && s.bytesReceived > 0)
      && stats.some(s => s.kind === 'video' && s.framesDecoded > 0);
  }), { timeout: 20000 }).toBe(true);
}

test('bidirectional media, mid-call devices, chat, controls and host-end', async ({ browser, context, page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.addInitScript(instrument);
  const url = await createRoom(page);
  const guestContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await guestContext.addInitScript(instrument);
  const guest = await guestContext.newPage();
  try {
    await guest.goto(url);
    await expect(guest.getByRole('button', { name: "I'm a student" })).toHaveAttribute('aria-pressed', 'true');
    await guest.getByLabel('Your name', { exact: true }).fill('Sam Taylor');
    await guest.getByRole('button', { name: 'Join meeting', exact: true }).click();
    await expect(guest.getByText('In meeting', { exact: true })).toBeVisible();
    // The offerer joins with no capture tracks, then adds both without renegotiation.
    await mediaReceived(guest);
    await guest.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await guest.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await mediaReceived(page);
    await expect(page.locator('[data-testid="tile-Sam Taylor"] video')).toBeVisible();
    await page.getByRole('button', { name: 'Show chat', exact: true }).click();
    await page.getByLabel('Message everyone').fill('Hello from the host');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await guest.getByRole('button', { name: 'Show chat', exact: true }).click();
    await expect(guest.getByText('Hello from the host', { exact: true })).toBeVisible();
    await guest.getByLabel('Message everyone').fill('<script>not code</script>');
    await guest.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByText('<script>not code</script>', { exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Raise hand', exact: true }).click();
    await expect(page.locator('[data-testid="tile-Sam Taylor"] .lucide-hand')).toBeVisible();
    await guest.getByRole('button', { name: 'Lower hand', exact: true }).click();
    await expect(page.locator('[data-testid="tile-Sam Taylor"] .lucide-hand')).toHaveCount(0);
    await guest.getByRole('button', { name: 'Mute microphone', exact: true }).click();
    await expect(page.locator('[data-testid="tile-Sam Taylor"] .lucide-mic-off')).toBeVisible();
    await guest.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await guest.getByRole('button', { name: 'Turn camera off', exact: true }).click();
    await expect(page.locator('[data-testid="tile-Sam Taylor"] .camera-empty')).toBeVisible();
    await guest.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await expect(page.locator('[data-testid="tile-Sam Taylor"] .camera-empty')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show participants', exact: true }).click();
    await page.getByRole('button', { name: 'Lock room', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unlock room', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Unlock room', exact: true }).click();
    await page.getByRole('button', { name: 'End meeting for everyone', exact: true }).click();
    await page.getByRole('button', { name: 'End for everyone', exact: true }).click();
    await expect(guest.getByText('Thanks for making time.', { exact: true })).toBeVisible();
    await expect(page.getByText('Thanks for making time.', { exact: true })).toBeVisible();
    expect(await guest.locator('video').evaluateAll(videos => videos.every(v => !v.srcObject))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await guestContext.close(); }
});

test('mobile navigation, invalid room, dark mode and device help', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page).toHaveTitle('Profconnect Meeting Place');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.getByRole('tab', { name: 'Join a meeting' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Jamie');
  await page.getByLabel('Meeting code or invite link').fill('invalid-room');
  await page.getByRole('button', { name: 'Join meeting', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('valid room code');
  await page.getByRole('button', { name: 'Device settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('System default camera');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Help and privacy', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Profconnect Meeting Place does not record calls');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'New meeting' }).click();
  await page.getByRole('button', { name: 'Start a meeting', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Leave meeting', exact: true })).toBeVisible();
  await expect(page.locator('.meeting-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show chat', exact: true }).click();
  await expect(page.getByLabel('Message everyone')).toBeVisible();
  await page.getByRole('button', { name: 'Close side panel', exact: true }).click();
  await page.getByRole('button', { name: 'Leave meeting', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave meeting', exact: true }).click();
  await expect(page.getByText('Thanks for making time.', { exact: true })).toBeVisible();
});

test('student and professor entry paths preserve invitations and guest access', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Join a meeting' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: "I'm a professor" }).click();
  await expect(page.getByRole('tab', { name: 'New meeting' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: "I'm a student" }).click();
  await expect(page.getByRole('tab', { name: 'Join a meeting' })).toHaveAttribute('aria-selected', 'true');
  await page.goto('/#/room/abcd-1234-5678');
  await page.reload();
  await page.getByRole('button', { name: "I'm a professor" }).click();
  await expect(page.getByRole('tab', { name: 'Join a meeting' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Meeting code or invite link')).toHaveValue('abcd-1234-5678');
  await expect(page.getByText('Guest access. No downloads required.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'ProfConnect portal' })).toHaveAttribute('href', 'https://profconnect-thapar.vercel.app/');
});
