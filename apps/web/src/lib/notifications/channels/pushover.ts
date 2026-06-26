import type { ChannelMessage, PushoverConfig } from './types';

const PUSHOVER_ENDPOINT = 'https://api.pushover.net/1/messages.json';

/**
 * Send a notification via Pushover (https://pushover.net/api). The endpoint is a
 * fixed public host, so — like Telegram — there is no user-supplied URL and no
 * SSRF surface to guard. Body is form-encoded; Pushover accepts UTF-8 in the
 * title/message, so no latin-1 stripping is needed (unlike ntfy headers).
 */
export async function sendPushover(config: PushoverConfig, message: ChannelMessage): Promise<void> {
  const form = new URLSearchParams();
  form.set('token', config.token);
  form.set('user', config.user);
  form.set('title', message.title);
  form.set('message', message.body);
  if (message.url) {
    form.set('url', message.url);
    form.set('url_title', 'View flight');
  }
  if (config.device) form.set('device', config.device);
  if (config.priority != null) form.set('priority', String(config.priority));

  const res = await fetch(PUSHOVER_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Pushover ${res.status}: ${detail.slice(0, 200)}`);
  }
}
