import { h, clear, dateTime, icon } from '../ui.js';
import { get, post } from '../api.js';
import { go } from '../nav.js';

export function bellWidget() {
  const n = h('span', { class: 'bell-n', hidden: true }, '0');
  const btn = h('button', { class: 'btn ghost small bell', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': 'Уведомления' }, bellIcon(), h('span', { class: 'lbl' }, 'Уведомления'), n);
  const wrap = h('div', { class: 'bell' }, btn);
  let panel = null;
  async function refresh() {
    try {
      const d = await get('/notifications');
      n.textContent = d.unread;
      n.hidden = d.unread === 0;
      return d;
    } catch { return null; }
  }
  async function toggle() {
    if (panel) { panel.remove(); panel = null; btn.setAttribute('aria-expanded', 'false'); return; }
    const d = await refresh();
    if (!d) return;
    panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Уведомления' },
      d.items.length ? d.items.map((i) => h('a', {
        class: `item${i.read ? '' : ' unread'}`, href: i.applicationId ? `#/applications/${i.applicationId}` : '#/',
        onclick: () => { panel?.remove(); panel = null; go(i.applicationId ? `#/applications/${i.applicationId}` : '#/'); },
      }, h('b', null, i.title), h('div', { class: 'small muted' }, i.body), h('div', { class: 'small muted' }, dateTime(i.createdAt))))
        : h('p', { class: 'muted', style: { padding: '16px' } }, 'Пока уведомлений нет. Здесь появятся ответы банка по заявкам.'));
    wrap.append(panel);
    btn.setAttribute('aria-expanded', 'true');
    if (d.unread) { await post('/notifications/read'); n.hidden = true; }
  }
  btn.addEventListener('click', toggle);
  document.addEventListener('click', (e) => { if (panel && !wrap.contains(e.target)) { panel.remove(); panel = null; btn.setAttribute('aria-expanded', 'false'); } });
  refresh();
  const t = setInterval(() => { if (!document.body.contains(wrap)) clearInterval(t); else refresh(); }, 5000);
  return wrap;
}

function bellIcon() { return icon('bell', 20); }
