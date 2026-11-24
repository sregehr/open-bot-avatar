// The demo host page: a mock Docebo shell showing where agent avatars appear (the AI panel, pages
// that embed an agent, AgentHub). Everything here drives the two custom elements through their
// attributes only, the way a real host would.
import { getAvatar } from '../src/index.ts';

const STATES = ['idle', 'thinking', 'working', 'waiting', 'blocked', 'done'];
const LABEL = { idle: 'Idle', thinking: 'Thinking', working: 'Working', waiting: 'Waiting', blocked: 'Blocked', done: 'Done' };
const STONE = '#e1dbd2';

/** The agents of the demo. `color` is the agent's product color; `task` scripts one run in the AI panel. */
const AGENTS = [
  {
    id: 'harmony', name: 'Harmony', role: 'Platform guidance', color: '#6a25dc', group: 'prebuilt', idle: 'Ready to help',
    about: 'Answers questions about the platform and takes admin actions for you.',
    prompt: 'What can I help you accomplish today?',
    asks: ['Who is overdue on compliance training?', 'Summarise this week’s enrolments', 'Set up a new learning plan'],
    task: { working: 'Searching enrolments', confirm: 'Send a reminder to 14 overdue learners?', done: 'Reminders are scheduled for 14 learners. I’ll report back on completions on Friday.' },
  },
  {
    id: 'authoring', name: 'Authoring Agent', role: 'Lesson creator', color: '#c54607', group: 'prebuilt', idle: 'Ready to create',
    about: 'Drafts lessons, quizzes and outlines from your source material.',
    prompt: 'What would you like to create today?',
    asks: ['Create a lesson on ladder safety', 'Turn this PDF into a quiz', 'Shorten lesson 3 to five minutes'],
    task: { working: 'Building the outline', confirm: 'Publish the five-part outline to the course?', done: 'The outline is published: five parts, about 12 minutes. Open the editor to adjust any part.' },
  },
  {
    id: 'marketplace', name: 'Marketplace Agent', role: 'Content marketplace', color: '#0057ff', group: 'prebuilt', idle: 'Ready to search',
    about: 'Finds and recommends courses from the content marketplace.',
    prompt: 'What courses are you looking for today?',
    asks: ['Find leadership courses under an hour', 'What’s new in data privacy?', 'Replace retiring courses'],
    task: { working: 'Searching the marketplace', confirm: 'Add 3 leadership courses to the catalogue?', done: 'Three courses are in the catalogue under Leadership. Two are under 45 minutes.' },
  },
  {
    id: 'reinforcement', name: 'Reinforcement Agent', role: 'Reinforcement tutor', color: '#8231c4', group: 'prebuilt', idle: 'Planning nudges',
    about: 'Schedules short recaps so learners keep what they learned.',
    prompt: 'What should we reinforce?',
    asks: ['Plan recaps for ladder safety', 'Who skipped last week’s recap?', 'Make the recaps shorter'],
    task: { working: 'Planning the recap schedule', confirm: 'Send the first recap tomorrow at 9:00?', done: 'The recap plan is live: three 2-minute recaps over the next two weeks.' },
  },
  {
    id: 'tutor', name: 'AI Tutor', role: 'Course tutor', color: '#18773c', group: 'prebuilt', idle: 'Ready to help',
    about: 'Explains course material and runs practice sessions with learners.',
    prompt: 'What would you like to learn or practice?',
    asks: ['Explain the three-point contact rule', 'Quiz me on lesson 2', 'Give me a real-world example'],
    task: { working: 'Reading lesson 2', confirm: 'Start a 5-question practice quiz?', done: 'Nice work: 4 of 5. Revisit the angle rule (1 out for every 4 up) before the final check.' },
  },
  {
    id: 'analytics', name: 'Analytics Agent', role: 'Reporting', color: '#145ca9', group: 'prebuilt', idle: 'Ready to report',
    about: 'Builds reports and explains what changed in your learning data.',
    prompt: 'What would you like to measure?',
    asks: ['Completion rate by department', 'Why did logins drop in March?', 'Build a weekly report'],
    task: { working: 'Querying learning data', confirm: 'Email this report to 6 managers every Monday?', done: 'The weekly report is scheduled. Completion is up 8% on last month.' },
  },
  {
    id: 'onboarding', name: 'Onboarding Buddy', role: 'Custom agent', color: '#0f766e', group: 'custom', idle: 'Ready to welcome',
    about: 'Walks new hires through their first two weeks.',
    prompt: 'Who are we welcoming?',
    asks: ['Plan week one for a new engineer', 'What is still missing for Priya?', 'Send the welcome pack'],
    task: { working: 'Assembling the welcome plan', confirm: 'Enrol Priya in the 6 onboarding courses?', done: 'Priya is enrolled. Her first check-in is on Wednesday.' },
  },
  {
    id: 'compliance', name: 'Compliance Agent', role: 'Custom agent', color: '#c31322', group: 'custom', idle: 'Monitoring',
    about: 'Tracks mandatory training and chases what is overdue.',
    prompt: 'What should I check?',
    asks: ['Which certificates expire this month?', 'Draft the audit summary', 'Chase overdue sign-offs'],
    task: { working: 'Checking certificates', confirm: 'Escalate 3 overdue sign-offs to managers?', done: 'Three managers have been notified. The audit summary is in your drafts.' },
  },
];
const agent = (id) => AGENTS.find((a) => a.id === id);

/** Which avatar each agent wears, per style. */
const STYLES = {
  branded: { label: 'Branded', of: { harmony: 'buddy-sphere', authoring: 'authoring-agent', marketplace: 'marketplace-agent', reinforcement: 'reinforcement-agent', tutor: 'tutor-agent', analytics: 'figure-sage', onboarding: 'buddy-cube', compliance: 'elemental-gem' } },
  characters: { label: 'Characters', of: { harmony: 'buddy-sphere', authoring: 'figure-builder', marketplace: 'pal-kit', reinforcement: 'figure-coach', tutor: 'figure-mentor', analytics: 'figure-sage', onboarding: 'buddy-cube', compliance: 'figure-guide' } },
  elemental: { label: 'Elemental', of: { harmony: 'elemental-sphere', authoring: 'elemental-steps', marketplace: 'elemental-arch', reinforcement: 'elemental-wave', tutor: 'elemental-dome', analytics: 'elemental-prism', onboarding: 'elemental-cube', compliance: 'elemental-gem' } },
  objects: { label: 'Objects', of: { harmony: 'robot', authoring: 'pencil', marketplace: 'folder', reinforcement: 'bell', tutor: 'owl', analytics: 'flask', onboarding: 'signpost', compliance: 'badge' } },
};
const COLORS = { own: 'Avatar’s own', agent: 'Agent colour', stone: 'Stone' };
const SCENES = [
  ['home', 'Home', 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z'],
  ['course', 'Course', 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M9 8h6'],
  ['creator', 'Lesson creator', 'M4 20h4l11-11-4-4L4 16zM13 7l4 4'],
  ['hub', 'AgentHub', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
];
const ICON = {
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  send: 'M12 19V5M6 11l6-6 6 6',
};
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

const S = {
  scene: 'home',
  style: 'branded',
  color: 'own',
  follow: true,
  flat: false,
  happy: false,
  active: 'harmony',
  // Docked beside the page where there is room; closed behind the ✦ button on narrow screens.
  panel: matchMedia('(min-width: 1081px)').matches,
  code: false,
  detail: null,
  nudgeOff: false,
  /** Avatars picked by hand in AgentHub; they win over the style. */
  picked: {},
  states: { harmony: 'idle', authoring: 'working', marketplace: 'idle', reinforcement: 'thinking', tutor: 'idle', analytics: 'done', onboarding: 'waiting', compliance: 'blocked' },
  thread: [],
  run: 0,
};

const avatarOf = (id) => S.picked[id] ?? STYLES[S.style].of[id];
const colorOf = (id) => (S.color === 'agent' ? agent(id).color : S.color === 'stone' ? STONE : '');

/** What a list or card says about an agent in its current state. */
function statusOf(id) {
  const a = agent(id);
  return { idle: a.idle, thinking: 'Thinking it through', working: `${a.task.working}…`, waiting: 'Waiting for your approval', blocked: 'Blocked: needs access', done: 'Session complete' }[S.states[id]];
}

/** One avatar bound to an agent. `fixed` pins a state; `still` draws a static SVG; `quiet` never follows the pointer. */
function A(id, size, { fixed = '', still = false, quiet = false } = {}) {
  return `<docebo-agent-avatar data-agent="${id}"${size ? ` size="${size}"` : ''}${fixed ? ` data-fixed="${fixed}"` : ''}${still ? ' data-still' : ''}${quiet ? ' data-quiet' : ''}></docebo-agent-avatar>`;
}
const pill = (id) => `<span class="pill" data-pill="${id}"></span>`;
const status = (id) => `<small data-status="${id}"></small>`;

// ---- Scenes

function home() {
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const notes = [
    ['onboarding', '#e6fb88', 'Priya’s onboarding plan is ready for your review'],
    ['compliance', '#ffe9e4', 'Three safety sign-offs need access to the HR system'],
    ['analytics', '#edf6ff', 'March completion report: up 8% on February'],
    ['reinforcement', '#e8dcff', 'Recap schedule for “Ladder safety” is being planned'],
  ];
  return `<div class="page">
    <section class="hero">
      <div>
        <span class="agent-badge">${A('harmony', 22, { fixed: 'idle', still: true })}Harmony</span>
        <p class="hello">${hello}, Jamie</p>
        <h1>${agent('harmony').prompt}</h1>
        <form class="ask" data-ask="harmony"><input aria-label="Ask Harmony" placeholder="Ask anything, or describe a task" /><button class="send" aria-label="Send">${svg(ICON.send)}</button></form>
        <div class="chips">${agent('harmony').asks.map((t) => `<button class="chip" data-act="ask" data-id="harmony" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      </div>
      ${A('harmony', '')}
    </section>
    <p class="note">Inline hero: one large live avatar that follows the pointer, plus a 22px still in the agent badge.</p>
    <section>
      <h2>Suggested agents</h2>
      <div class="grid3" style="margin-top:12px">${['tutor', 'marketplace', 'authoring'].map((id) => `<button class="card mini" data-act="open" data-id="${id}">${A(id, 44, { quiet: true })}<span><b>${agent(id).name}</b>${status(id)}</span></button>`).join('')}</div>
    </section>
    <section>
      <h2>Needs your attention</h2>
      <div class="grid2" style="margin-top:12px">${notes.map(([id, tone, text]) => `<article class="note-card" style="--tone:${tone}">${pill(id)}<h3>${text}</h3><footer>${A(id, 28, { quiet: true })}${agent(id).name}<button class="btn dark" data-act="open" data-id="${id}">Open</button></footer></article>`).join('')}</div>
    </section>
  </div>`;
}

function course() {
  const lessons = [['Why ladders fail', '6 min', 1], ['Choosing the right ladder', '8 min', 1], ['Setting up: angle and footing', '7 min', 0], ['Three points of contact', '5 min', 0], ['Final check', '10 min', 0]];
  const rows = lessons.map(([name, time, done], i) => `<div><i class="n${done ? ' ok' : ''}">${done ? '✓' : i + 1}</i><b>${name}</b><span>${time}</span></div>`);
  rows.splice(3, 0, `<div class="tip">${A('tutor', 32, { quiet: true })}<p><b>Tutor tip.</b> Most learners find the 4-to-1 angle rule tricky. Want a quick visual before you start?</p><button class="btn" data-act="ask" data-id="tutor" data-text="Explain the 4-to-1 angle rule">Show me</button></div>`);
  return `<div class="page">
    <div class="cover"><p>Workplace safety · 5 lessons</p><h1>Ladder safety essentials</h1></div>
    <div class="course">
      <div class="card lessons">${rows.join('')}</div>
      <div class="side">
        <div class="card"><div class="row">${A('tutor', 56)}<div><b>${agent('tutor').name}</b><br />${status('tutor')}</div></div><p class="sub">The AI tutor is on for this course.</p><button class="btn ai" data-act="open" data-id="tutor">Ask the tutor</button></div>
        <div class="card"><div class="row">${A('reinforcement', 40, { quiet: true })}<div><b>2-minute recap ready</b><br />${status('reinforcement')}</div></div><button class="btn" data-act="open" data-id="reinforcement">Start recap</button></div>
      </div>
    </div>
    <p class="note">Embedded in a page: a 56px card avatar, a 32px inline tip, and a floating 60px companion in the corner.</p>
    <div class="fab"><span class="say">Stuck on this lesson? Ask me.</span><button data-act="open" data-id="tutor" aria-label="Open the AI tutor">${A('tutor', 60)}</button></div>
  </div>`;
}

function creator() {
  const blocks = [['Why ladders fail', 'Three real incidents and what they have in common.'], ['Choosing the right ladder', 'Height, load rating and material.'], ['Setting up', 'The 4-to-1 angle rule and firm footing.'], ['Three points of contact', 'Climbing, carrying and reaching.'], ['Final check', 'Ten questions with feedback.']];
  return `<div class="page">
    <header><h1>Lesson creator</h1><p>The authoring agent works in the panel while the outline fills in beside it. Change its state in the controls above, or press “Run a task”.</p></header>
    <div class="card editor">
      <div class="head">${A('authoring', 40, { quiet: true })}<div><b>Ladder safety essentials</b><br />${status('authoring')}</div>${pill('authoring')}</div>
      <div class="banner" data-banner></div>
      ${blocks.map(([t, d], i) => `<div class="block" data-block="${i}"><b>${t}</b><p>${d}</p></div>`).join('')}
    </div>
    <p class="note">The avatar’s <code>state</code> attribute is the only thing that changes: thinking, working, waiting, done.</p>
  </div>`;
}

function hub() {
  if (S.detail) {
    const a = agent(S.detail);
    return `<div class="page">
      <button class="btn back" data-act="detail" data-id="">← All agents</button>
      <header><h1>${a.name}</h1><p>${a.about}</p></header>
      <div class="card detail">
        <div class="preview">${A(a.id, '')}<strong>${a.name}</strong><small data-avatar-name></small><button class="btn" data-act="open" data-id="${a.id}">Open chat</button></div>
        <div><h2>Choose an avatar</h2><p class="sub" style="margin:4px 0 14px">Picked with <code>&lt;docebo-avatar-picker&gt;</code>. Every surface in this demo updates.</p><docebo-avatar-picker value="${avatarOf(a.id)}"></docebo-avatar-picker></div>
      </div>
    </div>`;
  }
  const tile = (a) => `<button class="card tile" style="--c:${a.color}" data-act="detail" data-id="${a.id}"><span class="pic">${A(a.id, 44, { quiet: true })}</span><b>${a.name}</b>${pill(a.id)}<p>${a.about}</p><span class="foot">${a.role}<em${a.id === 'analytics' ? ' class="off">Draft' : '>Enabled'}</em></span></button>`;
  const section = (group, title) => {
    const list = AGENTS.filter((a) => a.group === group);
    return `<section><h2>${title} (${list.length})</h2><div class="grid2" style="margin-top:12px">${list.map(tile).join('')}</div></section>`;
  };
  return `<div class="page"><header><h1>AgentHub</h1><p>Every agent with its avatar and live state. Open one to change its avatar.</p></header>${section('custom', 'Custom agents')}${section('prebuilt', 'Pre-built agents')}</div>`;
}

const RENDER = { home, course, creator, hub };

// ---- AI panel

function panel() {
  const a = agent(S.active);
  const body = S.thread.length
    ? S.thread
        .map((m) => {
          if (m.who === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
          if (m.who === 'meta') return `<div class="msg meta">${esc(m.text)}</div>`;
          if (m.who === 'agent') return `<div class="msg agent">${A(a.id, 28, { fixed: 'idle', quiet: true })}<p>${esc(m.text)}</p></div>`;
          return `<div class="think">${A(a.id, 32, { quiet: true })}<b data-think></b><small data-think-sub></small><div class="confirm" data-confirm><button class="btn dark" data-act="confirm">Confirm</button><button class="btn" data-act="cancel">Cancel</button></div></div>`;
        })
        .join('')
    : `<div class="empty"><div class="orb">${A(a.id, 96)}</div><h2>${a.name}</h2><p class="sub">${a.prompt}</p><div class="suggest"><i>Suggested</i>${a.asks.map((t) => `<button data-act="ask" data-id="${a.id}" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`;
  return `<header><div><button class="icon-btn" data-act="new" aria-label="New chat" title="New chat">${svg(ICON.plus)}</button></div><b>${a.name}</b><div><button class="icon-btn" data-act="panel" aria-label="Close" title="Close">${svg(ICON.close)}</button></div></header>
    <div style="display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0">
      <div class="switch" role="group" aria-label="Switch agent">${AGENTS.map((x) => `<button data-act="open" data-id="${x.id}" style="--c:${x.color}" aria-pressed="${x.id === a.id}" aria-label="${x.name}" title="${x.name}">${A(x.id, 30, { fixed: 'idle', still: true })}</button>`).join('')}</div>
      <div class="body">${body}</div>
    </div>
    <form class="composer" data-ask="${a.id}"><input aria-label="Message ${a.name}" placeholder="Message ${a.name}" /><button class="send" aria-label="Send">${svg(ICON.send)}</button></form>`;
}

function drawPanel() {
  const el = $('.panel');
  el.hidden = !S.panel;
  el.style.setProperty('--c', agent(S.active).color);
  el.innerHTML = panel();
  const body = $('.body', el);
  body.scrollTop = body.scrollHeight;
  refresh();
}

function drawScene() {
  $('.view').innerHTML = RENDER[S.scene]();
  $('.view').scrollTop = 0;
  refresh();
}

function setState(id, state) {
  S.states[id] = state;
  refresh();
}

function open(id) {
  if (id !== S.active) {
    S.run++;
    S.thread = [];
    S.active = id;
  }
  S.panel = true;
  drawPanel();
}

/** One scripted run in the panel: the agent thinks, works, asks for approval, and finishes. */
async function ask(id, text) {
  open(id);
  const run = ++S.run;
  const live = () => run === S.run;
  S.thread = S.thread.filter((m) => m.who !== 'status');
  S.thread.push({ who: 'user', text }, { who: 'status' });
  drawPanel();
  setState(id, 'thinking');
  await wait(1900);
  if (!live()) return;
  setState(id, 'working');
  await wait(3200);
  if (live()) setState(id, 'waiting');
}

async function settle(ok) {
  const id = S.active;
  const run = ++S.run;
  if (!ok) return setState(id, 'blocked');
  setState(id, 'working');
  await wait(1500);
  if (run !== S.run) return;
  S.thread = S.thread.filter((m) => m.who !== 'status');
  S.thread.push({ who: 'meta', text: 'Reasoned for 6 seconds' }, { who: 'agent', text: agent(id).task.done });
  S.states[id] = 'done';
  drawPanel();
}

// ---- Keeping the page in step with the state

const flag = (el, name, on) => (on ? el.setAttribute(name, '') : el.removeAttribute(name));
const attr = (el, name, value) => (value ? el.setAttribute(name, value) : el.removeAttribute(name));

function snippet() {
  const id = S.detail ?? S.active;
  const attrs = [`avatar="${avatarOf(id)}"`, `state="${S.states[id]}"`];
  if (colorOf(id)) attrs.push(`color="${colorOf(id)}"`);
  if (S.happy) attrs.push('mood="happy"');
  attrs.push('size="64"');
  if (S.follow) attrs.push('follow-pointer');
  if (S.flat) attrs.push('flat');
  return `<script type="module" src="docebo-agent-avatars.js"></script>\n\n<!-- ${agent(id).name} -->\n<docebo-agent-avatar ${attrs.join(' ')}></docebo-agent-avatar>\n<docebo-avatar-picker value="${avatarOf(id)}"></docebo-avatar-picker>`;
}

const BANNER = {
  idle: 'Draft outline. Ask the authoring agent to change it.',
  thinking: 'The agent is reading your source material.',
  working: 'The agent is writing the outline, part by part.',
  waiting: 'Outline ready. The agent is waiting for you to approve publishing.',
  blocked: 'Stopped: the agent needs access to the media library.',
  done: 'Published to the course.',
};

function refresh() {
  for (const el of $$('docebo-agent-avatar[data-agent]')) {
    const id = el.dataset.agent;
    attr(el, 'avatar', avatarOf(id));
    attr(el, 'color', colorOf(id));
    attr(el, 'state', el.dataset.fixed || S.states[id]);
    attr(el, 'mood', S.happy ? 'happy' : '');
    attr(el, 'label', agent(id).name);
    flag(el, 'follow-pointer', S.follow && !('quiet' in el.dataset) && !('still' in el.dataset));
    flag(el, 'flat', S.flat);
    flag(el, 'still', 'still' in el.dataset);
  }
  for (const el of $$('[data-status]')) el.textContent = statusOf(el.dataset.status);
  for (const el of $$('[data-pill]')) {
    el.dataset.state = S.states[el.dataset.pill];
    el.textContent = LABEL[el.dataset.state];
  }
  for (const el of $$('[data-avatar-name]')) el.textContent = getAvatar(avatarOf(S.detail))?.name ?? '';

  // The thinking card in the panel follows the active agent's state.
  const a = agent(S.active), state = S.states[S.active];
  const think = $('[data-think]');
  if (think) {
    think.textContent = { idle: 'Paused', thinking: 'Thinking it through', working: a.task.working, waiting: 'Please confirm my action', blocked: 'Stopped before finishing', done: 'Done' }[state];
    $('[data-think-sub]').textContent = { thinking: 'Understanding your request and deciding how to help', waiting: a.task.confirm, blocked: 'This action is no longer available.' }[state] ?? '';
    $('[data-confirm]').hidden = state !== 'waiting';
  }

  // The lesson creator's outline fills in as the authoring agent works.
  const authoring = S.states.authoring;
  $('.view').dataset.authoring = authoring;
  const filled = { thinking: 0, working: 2 }[authoring] ?? 5;
  for (const el of $$('[data-block]')) el.classList.toggle('wait', Number(el.dataset.block) >= filled);
  const banner = $('[data-banner]');
  if (banner) banner.textContent = BANNER[authoring];

  // Controls
  for (const el of $$('.seg')) for (const b of el.children) b.setAttribute('aria-pressed', String(b.dataset.v === (el.dataset.seg === 'state' ? S.states[S.active] : S[el.dataset.seg])));
  $('#agent').value = S.active;
  for (const b of $$('.nav [data-scene]')) attr(b, 'aria-current', b.dataset.scene === S.scene ? 'page' : '');
  $('.launch').setAttribute('aria-pressed', String(S.panel));
  $('#code').hidden = !S.code;
  $('#code').textContent = snippet();
  $('[data-act="code"]').setAttribute('aria-pressed', String(S.code));

  // The nudge: agents waiting for the user, shown while the panel is closed.
  const waiting = AGENTS.filter((x) => S.states[x.id] === 'waiting');
  const badge = $('.badge');
  badge.hidden = !waiting.length;
  badge.textContent = waiting.length;
  const nudge = $('.nudge');
  const first = waiting[0];
  nudge.hidden = !first || S.panel || S.nudgeOff;
  const key = first && `${first.id}:${waiting.length}`;
  if (first && nudge.dataset.key !== key) {
    nudge.dataset.key = key;
    nudge.dataset.id = first.id;
    nudge.innerHTML = `${A(first.id, 48, { quiet: true })}<span><i>Agent update</i><b>You have ${waiting.length} ${waiting.length > 1 ? 'chats' : 'chat'} waiting</b><small>Select this message to open your chat with ${first.name}.</small></span>`;
    refresh();
  }
}

// ---- Wiring

function build() {
  const seg = (key, options) => `<div class="seg" data-seg="${key}" role="group">${options.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>`;
  $('.bar').innerHTML = `<div class="title">Agent avatars<small>Embed demo</small></div>
    <div class="ctl"><span>Avatar style</span>${seg('style', Object.entries(STYLES).map(([v, s]) => [v, s.label]))}</div>
    <div class="ctl"><span>Colour</span>${seg('color', Object.entries(COLORS))}</div>
    <label class="ctl"><span>Agent</span><select id="agent">${AGENTS.map((a) => `<option value="${a.id}">${a.name}</option>`).join('')}</select></label>
    <div class="ctl"><span>State</span>${seg('state', STATES.map((s) => [s, LABEL[s]]))}</div>
    <div class="ctl"><span>Options</span><div class="checks">${[['follow', 'Follow pointer'], ['flat', 'Flat'], ['happy', 'Happy']].map(([k, l]) => `<label><input type="checkbox" data-opt="${k}"${S[k] ? ' checked' : ''} />${l}</label>`).join('')}</div></div>
    <div class="go"><button class="btn primary" data-act="run">Run a task</button><button class="btn" data-act="code">Embed code</button><a class="btn" id="editor" href="http://localhost:5173/open-bot-avatar/">Avatar editor</a></div>
    <pre class="code" id="code" hidden></pre>`;
  // The editor (apps/site) is served elsewhere: its dev server, unless VITE_EDITOR_URL names another place.
  if (import.meta.env.VITE_EDITOR_URL) $('#editor').href = import.meta.env.VITE_EDITOR_URL;

  $('.top').innerHTML = `<span class="logo">docebo</span><span class="search">${svg(ICON.search)}Search</span><span class="spacer"></span>
    <button class="icon-btn launch" data-act="panel" aria-label="AI assistant" title="AI assistant">${svg(ICON.spark)}<span class="badge" hidden></span></button>
    <button class="icon-btn" aria-label="Notifications">${svg(ICON.bell)}</button><span class="me" aria-label="Jamie">JD</span>
    <button class="nudge" data-act="nudge" hidden></button>`;
  $('.nav').innerHTML = `${SCENES.map(([id, label, d]) => `<button data-scene="${id}">${svg(d)}${label}</button>`).join('')}<p class="hint">Each page shows a different place an agent avatar lives. The AI panel opens from the ✦ button on any page.</p>`;

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-act], [data-scene], .seg button');
    if (!target) return;
    if (target.dataset.scene) {
      S.scene = target.dataset.scene;
      S.detail = null;
      if (S.scene === 'creator' && S.active !== 'authoring') open('authoring');
      return drawScene();
    }
    if (target.dataset.v) {
      const key = target.parentElement.dataset.seg;
      if (key === 'state') {
        S.run++;
        return setState(S.active, target.dataset.v);
      }
      S[key] = target.dataset.v;
      if (key === 'style') {
        S.picked = {};
        for (const picker of $$('docebo-avatar-picker')) picker.value = avatarOf(S.detail);
      }
      return refresh();
    }
    const { act, id, text } = target.dataset;
    if (act === 'panel') {
      S.panel = !S.panel;
      S.nudgeOff = false;
      drawPanel();
    } else if (act === 'open') open(id);
    else if (act === 'nudge') open(target.dataset.id);
    else if (act === 'ask') ask(id, text);
    else if (act === 'run') ask(S.active, agent(S.active).asks[0]);
    else if (act === 'confirm') settle(true);
    else if (act === 'cancel') settle(false);
    else if (act === 'new') {
      S.run++;
      S.thread = [];
      S.states[S.active] = 'idle';
      drawPanel();
    } else if (act === 'code') {
      S.code = !S.code;
      refresh();
    } else if (act === 'detail') {
      S.detail = id || null;
      // The controls above act on the agent being looked at.
      if (id && id !== S.active) {
        S.run++;
        S.thread = [];
        S.active = id;
        drawPanel();
      }
      drawScene();
    }
  });
  document.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('input', event.target);
    const text = input.value.trim();
    if (text) ask(event.target.dataset.ask, text);
    input.value = '';
  });
  document.addEventListener('change', (event) => {
    const el = event.target;
    if (el.id === 'agent') open(el.value);
    else if (el.dataset?.opt) {
      S[el.dataset.opt] = el.checked;
      refresh();
    } else if (el.localName === 'docebo-avatar-picker' && S.detail) {
      S.picked[S.detail] = event.detail.id;
      refresh();
    }
  });

  drawScene();
  drawPanel();
}

build();
