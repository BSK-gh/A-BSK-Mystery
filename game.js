(() => {
  'use strict';

  const TOTAL_SECONDS = 15 * 60;
  const HINT_PENALTY = 30;
  const WRONG_SUSPECT_PENALTY = 60;
  const CODE = '2164';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  let state;
  let tick = null;
  let keypadHandler = null;

  const freshState = () => ({
    name: '', endAt: 0, over: false, hintsUsed: 0,
    lantern: false, bookOpen: false, bustsMatched: false,
    digits: [null, null, null, null],
    clues: { pass: false, humble: false, note: false },
    solved: { capsule: false, map: false, book: false, busts: false, mirror: false, door: false },
    facts: {}, keypad: '', hintsShown: {},
  });

  /* ---------- Quip ---------- */
  let quipTimer;
  function quip(who, msg, ms = 4000) {
    const el = $('#quip');
    el.innerHTML = `<b>${who}</b>${msg}`;
    el.classList.add('show');
    clearTimeout(quipTimer);
    quipTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /* ---------- Timer ---------- */
  const remaining = () => Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  function renderTimer() {
    const r = remaining();
    const el = $('#timer');
    el.textContent = fmt(r);
    el.classList.toggle('warn', r <= 180 && r > 60);
    el.classList.toggle('danger', r <= 60);
    if (r <= 0 && !state.over) lose();
  }
  function penalize(sec) {
    state.endAt -= sec * 1000;
    const el = $('#timer');
    el.classList.remove('penalty'); void el.offsetWidth; el.classList.add('penalty');
    renderTimer();
  }

  /* ---------- HUD ---------- */
  function renderHud() {
    $$('.digits b').forEach((b, i) => {
      const d = state.digits[i];
      b.textContent = d ?? '?';
      b.classList.toggle('found', d !== null);
    });
    $('#clue-count').textContent = `${Object.values(state.clues).filter(Boolean).length}/3`;
    Object.entries(state.solved).forEach(([k, v]) => $(`[data-obj="${k}"]`)?.classList.toggle('solved', v));
    $('#lantern-glow').classList.toggle('on', state.lantern);
  }
  const setDigit = (i, d) => { state.digits[i] = d; renderHud(); };

  /* ---------- Modal ---------- */
  const modal = $('#modal');
  const body = $('#modal-body');
  let lastFocus = null;
  function openModal(html, after) {
    keypadHandler = null;
    lastFocus = document.activeElement;
    body.innerHTML = html;
    modal.hidden = false;
    if (after) after(body);
    const first = body.querySelector('input, select, .toggle button, .suspect, .keypad button, .btn') || $('#modal-close');
    setTimeout(() => first && first.focus(), 30);
  }
  function closeModal() {
    keypadHandler = null;
    modal.hidden = true;
    body.innerHTML = '';
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }
  $('#modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) { closeModal(); return; }
    if (keypadHandler && !modal.hidden) keypadHandler(e);
  });

  const norm = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function hintBlock(id, text) {
    if (state.hintsShown[id]) return `<div class="hint-box"><strong>Velma's hint:</strong> ${text}</div>`;
    return `<button class="btn-hint" data-hint="${id}">Ask Velma for a hint (−${HINT_PENALTY} sec)</button>`;
  }
  function wireHint(root, id, text) {
    const b = root.querySelector(`[data-hint="${id}"]`);
    if (!b) return;
    b.addEventListener('click', () => {
      state.hintsShown[id] = true; state.hintsUsed++;
      penalize(HINT_PENALTY);
      b.outerHTML = `<div class="hint-box"><strong>Velma's hint:</strong> ${text}</div>`;
    });
  }
  const answerForm = (ph, numeric) =>
    `<form class="answer" autocomplete="off"><input type="text" ${numeric ? 'inputmode="numeric"' : ''} placeholder="${ph}" aria-label="${ph}"><button class="btn btn-primary" type="submit">Try it</button></form><div class="feedback" aria-live="polite"></div>`;
  function wireAnswer(root, check, wrongLines) {
    const f = root.querySelector('form.answer');
    const fb = f.nextElementSibling;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = norm(f.querySelector('input').value);
      if (!v) return;
      if (check(v)) return;
      fb.className = 'feedback bad';
      fb.textContent = pick(wrongLines);
      f.querySelector('input').select();
    });
  }
  const reward = (ico, html) => `<div class="reward"><div class="ico">${ico}</div><div>${html}</div></div>`;
  const backBtn = `<div class="end-actions"><button class="btn btn-primary" data-close>Back to the hall</button></div>`;
  const wireBack = (root) => root.querySelector('[data-close]')?.addEventListener('click', closeModal);

  /* ---------- Clues ---------- */
  const CLUE_TEXT = {
    pass: 'A torn boarding pass stub: <strong>PDX → FAT</strong>. Whoever dropped it flew into Fresno from the Portland / Vancouver, WA area.',
    humble: 'The <strong>HUMBLE</strong> nameplate on the busts was scratched off. Somebody here really hates sharing the credit.',
    note: 'A crumpled note in spooky handwriting: <strong>"Scare them out. Buy them out. Own it ALL myself."</strong>',
  };

  /* ---------- Map SVG ---------- */
  function mapSvg() {
    const P = (lon, lat) => [((lon + 125.2) * 22.5).toFixed(1), ((49.6 - lat) * 30).toFixed(1)];
    const poly = (pts) => pts.map(([lo, la]) => P(lo, la).join(',')).join(' ');
    const WA = [[-124.7,48.4],[-123.2,48.2],[-122.8,49],[-117,49],[-117,46],[-119,46],[-121.2,45.7],[-122.2,45.6],[-123,46.2],[-124,46.3]];
    const OR = [[-124,46.3],[-123,46.2],[-122.2,45.6],[-121.2,45.7],[-119,46],[-116.9,46],[-116.5,45.5],[-117,44.3],[-117,42],[-124.2,42],[-124.6,43.5]];
    const CA = [[-124.2,42],[-120,42],[-120,39],[-114.6,35],[-114.6,32.7],[-117.1,32.5],[-118.5,34],[-120.6,34.6],[-121.9,36.6],[-122.5,37.8],[-123.8,39.8]];
    const NV = [[-120,42],[-114,42],[-114,36.1],[-114.6,35],[-120,39]];
    const ID = [[-117,49],[-116,49],[-116,44.5],[-111.1,44.5],[-111.1,42],[-117,42],[-117,44.3],[-116.5,45.5],[-116.9,46],[-117,46]];
    const offices = [
      ['Vancouver', -122.66, 45.64], ['Sacramento', -121.35, 38.55], ['Livermore', -121.77, 37.68], ['San Jose', -121.93, 37.39],
      ['Tracy', -121.43, 37.74], ['Fresno HQ', -119.83, 36.82], ['Fresno Lab', -119.62, 36.72], ['Visalia', -119.29, 36.33],
      ['Bakersfield', -119.02, 35.37], ['Redlands', -117.18, 34.06], ['Palm Springs', -116.54, 33.83],
    ];
    const label = (t, lon, lat) => { const [x, y] = P(lon, lat); return `<text x="${x}" y="${y}" fill="rgba(239,234,249,.32)" font-size="11" font-weight="700" letter-spacing="2.5" text-anchor="middle" font-family="General Sans, sans-serif">${t}</text>`; };
    const pins = offices.map(([n, lo, la], i) => {
      const [x, y] = P(lo, la);
      const right = ['Vancouver', 'Fresno Lab', 'Visalia', 'Bakersfield', 'Redlands', 'Palm Springs', 'Sacramento', 'Tracy'].includes(n);
      const dy = { 'Livermore': -7, 'San Jose': 11, 'Tracy': -3, 'Fresno HQ': 2, 'Fresno Lab': -3, 'Visalia': 10, 'Sacramento': -4, 'Redlands': -3, 'Palm Springs': 10 }[n] ?? 4;
      return `<g class="pin" style="animation-delay:${i * .17}s"><circle cx="${x}" cy="${y}" r="7" fill="rgba(100,255,168,.25)"/><circle cx="${x}" cy="${y}" r="3.2" fill="#64ffa8"/></g>
        <text x="${(+x + (right ? 8 : -8)).toFixed(1)}" y="${(+y + dy).toFixed(1)}" fill="#efeaf9" font-size="11.5" font-weight="600" text-anchor="${right ? 'start' : 'end'}" font-family="General Sans, sans-serif">${n}</text>`;
    }).join('');
    return `<svg viewBox="-75 10 360 500" style="max-height:470px;margin:0 auto" role="img" aria-label="Map of BSK's 11 offices on the West Coast">
      <polygon points="${poly(NV)}" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.12)"/>
      <polygon points="${poly(OR)}" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.16)"/>
      <polygon points="${poly(WA)}" fill="rgba(155,123,255,.16)" stroke="rgba(155,123,255,.6)"/>
      <polygon points="${poly(CA)}" fill="rgba(155,123,255,.16)" stroke="rgba(155,123,255,.6)"/>
      ${label('WASHINGTON', -120.5, 47.6)}${label('OREGON', -120.3, 43.9)}${label('NEVADA', -116.9, 39.6)}${label('CALIFORNIA', -120.6, 40.6)}
      ${pins}</svg>`;
  }

  /* ---------- Puzzles ---------- */
  const puzzles = {
    capsule() {
      if (state.solved.capsule) {
        return openModal(`<h2>The Founders' Time Capsule</h2><p class="who">Already opened</p>
          ${reward('✦', '<strong>Item:</strong> The Founder\'s Lantern (lit, and slightly haunted).')}
          ${reward('1', `<strong>Clue:</strong> ${CLUE_TEXT.pass}`)}`);
      }
      const hint = 'BSK is celebrating 60 years of service in 2026. Subtract 60 from 2026.';
      openModal(`<h2>The Founders' Time Capsule</h2><p class="who">Fred: "It's sealed with a 4-digit year lock."</p>
        <p>An engraved brass plate on the lid reads:</p>
        <div class="note">"Sealed by the founders. I open only for the year it all began. Six decades later, in 2026, the employee-owners still carry the torch."</div>
        ${answerForm('4-digit year', true)}
        ${hintBlock('capsule', hint)}`, (root) => {
        wireHint(root, 'capsule', hint);
        wireAnswer(root, (v) => {
          if (v !== '1966') return false;
          state.solved.capsule = true; state.lantern = true; state.clues.pass = true; renderHud();
          root.innerHTML = `<h2>The Founders' Time Capsule</h2><p class="who">Unlocked · Fresno, 1966</p>
            <p>The lid creaks open with a puff of 60-year-old dust. Inside: the founders' original lantern, still flickering, and something that definitely wasn't here in 1966.</p>
            ${reward('✦', '<strong>Item found:</strong> The Founder\'s Lantern. Dark corners of the hall should be easier to read now.')}
            ${reward('1', `<strong>Clue found:</strong> ${CLUE_TEXT.pass}`)}${backBtn}`;
          wireBack(root);
          quip('Velma', 'Jinkies! 1966, the year BSK was founded. And a lantern.');
          return true;
        }, ['Ruh-roh. The lock won\'t budge. Think about when BSK began.', 'Not that year. Hint: we\'re celebrating 60 years.', 'Zoinks, wrong year, man.']);
      });
    },

    map() {
      const hint = 'Look at which highlighted states have glowing pins. Vancouver is just across the river from Portland, but it\'s in Washington.';
      if (!state.lantern) {
        openModal(`<h2>The Old Office Map</h2><p class="who">Daphne: "It's way too dark to read."</p>
          <div class="mapwrap dark" aria-hidden="true">${mapSvg()}</div>
          <p style="margin-top:12px">Faint pins glimmer on the map, but you can't make out a thing. If only the founders had left a light around here somewhere.</p>`);
        return;
      }
      if (state.solved.map) {
        return openModal(`<h2>The Old Office Map</h2><p class="who">Already solved</p><div class="mapwrap">${mapSvg()}</div>
          ${reward('2', '<strong>Digit #1 is 2.</strong> 11 offices across 2 states.')}`);
      }
      openModal(`<h2>The Old Office Map</h2><p class="who">Lantern raised · 11 pins glowing</p>
        <div class="mapwrap">${mapSvg()}</div>
        <p style="margin-top:12px">Scrawled across the bottom in glowing ink: <strong>"Digit #1 = the number of states with a BSK office."</strong></p>
        ${answerForm('How many states?', true)}
        ${hintBlock('map', hint)}`, (root) => {
        wireHint(root, 'map', hint);
        wireAnswer(root, (v) => {
          if (v !== '2' && v !== 'TWO') return false;
          state.solved.map = true; setDigit(0, '2');
          root.querySelector('form').nextElementSibling.remove(); root.querySelector('form').remove();
          root.querySelector('.hint-box, [data-hint]')?.remove();
          root.insertAdjacentHTML('beforeend', reward('2', '<strong>Digit #1 is 2.</strong> California and Washington. That\'s 11 offices haunting two states, in the best way.'));
          quip('Daphne', 'Two states, eleven offices. The first digit is 2.');
          return true;
        }, ['Count again. Only the highlighted states have pins.', 'Not quite. Look closely at the pin up north.']);
      });
    },

    book() {
      const scr = [['P','L','O','Y','M','E','E','E'], ['T','C','O','S','K'], ['N','O','R','E','H','W','S','P','I'], ['L','A','N','P']];
      const tiles = `<div class="tiles">${scr.map(w => `<span class="word">${w.map(c => `<b>${c}</b>`).join('')}</span>`).join('')}</div>`;
      const hint1 = 'It\'s what the letters E-S-O-P stand for. First word: EMPLOYEE.';
      const hint2 = 'BSK\'s careers page says eligible full-time employees get an ownership stake after this many year(s) of continuous service. It\'s a small number.';
      const stage2 = (root) => {
        root.innerHTML = `<h2>The Owner's Manual</h2><p class="who">Unlocked · Chapter 1: Joining the Owners' Club</p>
          <p>The clasp glows and the book falls open. Most of the page has faded, but one line is still legible:</p>
          <div class="note">"At BSK, eligible full-time employees receive an ownership stake in the ESOP after <strong>___</strong> year(s) of continuous service. Write the number in the margin and it shall be Digit #2."</div>
          ${state.solved.book ? reward('1', '<strong>Digit #2 is 1.</strong>') : answerForm('How many years?', true) + hintBlock('book2', hint2)}`;
        if (state.solved.book) return;
        wireHint(root, 'book2', hint2);
        wireAnswer(root, (v) => {
          if (v !== '1' && v !== 'ONE') return false;
          state.solved.book = true; setDigit(1, '1');
          stage2(root);
          root.insertAdjacentHTML('beforeend', `<p style="margin-top:12px">A ghostly voice whispers, "You've got a real <em>stake</em> in this place." Not the vampire kind, thankfully.</p>`);
          quip('Shaggy', 'Like, one year and you\'re an owner? Groovy. Digit #2 is 1.');
          return true;
        }, ['The margin ink fades away. Try a different number.', 'Not quite. Think about the first-year milestone.']);
      };
      if (state.bookOpen) return openModal('', stage2);
      openModal(`<h2>The Owner's Manual</h2><p class="who">Velma: "The clasp is a word lock!"</p>
        <p>A massive leather book titled <strong>The Owner's Manual</strong> is locked shut. The clasp reads <strong>"Speak the name of the plan we all share."</strong> Below it, scrambled letter tiles:</p>
        ${tiles}
        <p style="font-size:14px;color:var(--muted);text-align:center">Unscramble all four words.</p>
        ${answerForm('Type the four words')}
        ${hintBlock('book1', hint1)}`, (root) => {
        wireHint(root, 'book1', hint1);
        wireAnswer(root, (v) => {
          if (v !== 'EMPLOYEESTOCKOWNERSHIPPLAN') return false;
          state.bookOpen = true;
          stage2(root);
          quip('Velma', 'Employee Stock Ownership Plan. E-S-O-P!');
          return true;
        }, ['The clasp rattles but stays shut. Hint: the first letters spell E-S-O-P.', 'Ruh-roh. Check your spelling on all four words.']);
      });
    },

    busts() {
      const hint1 = 'Hungry = always looking for more to do. Humble = shares the credit. Smart = people-smart and reads the room.';
      const hint2 = 'BSK was founded in 1966 and turns 60 in 2026. How many decades is that?';
      const stage2 = (root) => {
        root.innerHTML = `<h2>The Ideal Team Player Busts</h2><p class="who">Matched · Hungry, Humble, Smart</p>
          <p>The three busts slowly turn to face you, and their eyes glow green. Under the center bust, the <strong>HUMBLE</strong> nameplate has fresh claw-like scratches across it.</p>
          ${reward('2', `<strong>Clue found:</strong> ${CLUE_TEXT.humble}`)}
          <div class="note" style="margin-top:16px">Carved into the pedestal: <strong>"Digit #3 = the number of decades BSK has served its communities, as of 2026."</strong></div>
          ${state.solved.busts ? reward('6', '<strong>Digit #3 is 6.</strong>') : answerForm('How many decades?', true) + hintBlock('busts2', hint2)}`;
        if (state.solved.busts) return;
        wireHint(root, 'busts2', hint2);
        wireAnswer(root, (v) => {
          if (v !== '6' && v !== 'SIX') return false;
          state.solved.busts = true; setDigit(2, '6');
          stage2(root);
          quip('Fred', 'Six decades. Digit #3 is 6. Sixty years and still bust-ing myths!');
          return true;
        }, ['The pedestal stays dark. 60 years is how many decades?', 'Not quite. Count by tens.']);
      };
      if (state.bustsMatched) return openModal('', stage2);
      const items = [
        ['hungry', 'Always looking for more to do and more to learn. Goes above and beyond without being asked.'],
        ['smart', 'People-smart. Reads the room and knows how their words land with teammates.'],
        ['humble', 'Quick to point out teammates\' contributions and shares the credit for every win.'],
      ];
      const opts = `<option value="">Choose…</option><option value="hungry">Hungry</option><option value="humble">Humble</option><option value="smart">Smart</option>`;
      openModal(`<h2>The Ideal Team Player Busts</h2><p class="who">Daphne: "These three are watching us."</p>
        <p>Three marble busts stand for the virtues of an Ideal Team Player. Their nameplates have fallen off. Match each description to the right virtue to put them back.</p>
        <div class="match">${items.map(([k, t], i) => `<label><span>${t}</span><select data-k="${k}" aria-label="Virtue for description ${i + 1}">${opts}</select></label>`).join('')}</div>
        <button class="btn btn-primary" id="busts-check">Place the nameplates</button>
        <div class="feedback" aria-live="polite"></div>
        ${hintBlock('busts1', hint1)}`, (root) => {
        wireHint(root, 'busts1', hint1);
        root.querySelector('#busts-check').addEventListener('click', () => {
          const sels = [...root.querySelectorAll('.match select')];
          const fb = root.querySelector('.feedback');
          if (sels.some(s => !s.value)) { fb.className = 'feedback bad'; fb.textContent = 'Pick a virtue for all three busts first.'; return; }
          const wrong = sels.filter(s => s.value !== s.dataset.k).length;
          if (wrong) { fb.className = 'feedback bad'; fb.textContent = `The busts frown. ${wrong} nameplate${wrong > 1 ? 's are' : ' is'} on the wrong bust.`; return; }
          state.bustsMatched = true; state.clues.humble = true; renderHud();
          stage2(root);
        });
      });
    },

    mirror() {
      const statements = [
        ['BSK is 100% employee-owned.', 'f'],
        ['BSK was founded in Fresno, California, in 1966.', 'f'],
        ['In an ESOP, employee-owners buy their shares out of their own paychecks.', 'm'],
        ['October is National Employee Ownership Month.', 'f'],
        ['Every BSK office is in California.', 'm'],
        ['BSK has more than 220 employees across 11 offices.', 'f'],
      ];
      const hint = 'Two of the six are myths. One is about how ESOP shares are paid for: the company contributes them, so employees don\'t buy them. The other was disproved by the map.';
      if (state.solved.mirror) {
        return openModal(`<h2>The Mirror of Truth</h2><p class="who">Already solved</p>
          ${reward('4', '<strong>Digit #4 is 4.</strong> Four facts, two myths.')}
          ${reward('3', `<strong>Clue found:</strong> ${CLUE_TEXT.note}`)}`);
      }
      openModal(`<h2>The Mirror of Truth</h2><p class="who">A ghostly face swirls in the glass</p>
        <p>The mirror hisses: <strong>"Mortals always mix up fact and myth. Sort them all correctly, and I'll reveal Digit #4: the number of FACTS."</strong></p>
        <div class="facts">${statements.map(([t], i) => `<div class="fact"><span>${t}</span><div class="toggle" role="group" aria-label="Fact or myth"><button class="f" data-i="${i}" data-v="f" aria-pressed="${state.facts[i] === 'f'}">Fact</button><button class="m" data-i="${i}" data-v="m" aria-pressed="${state.facts[i] === 'm'}">Myth</button></div></div>`).join('')}</div>
        <button class="btn btn-primary" id="mirror-check">Show me the truth</button>
        <div class="feedback" aria-live="polite"></div>
        ${hintBlock('mirror', hint)}`, (root) => {
        wireHint(root, 'mirror', hint);
        root.querySelectorAll('.toggle button').forEach(b => b.addEventListener('click', () => {
          state.facts[b.dataset.i] = b.dataset.v;
          b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        }));
        root.querySelector('#mirror-check').addEventListener('click', () => {
          const fb = root.querySelector('.feedback');
          if (statements.some((_, i) => !state.facts[i])) { fb.className = 'feedback bad'; fb.textContent = 'The mirror waits. Mark every statement as Fact or Myth.'; return; }
          const wrong = statements.filter(([, a], i) => state.facts[i] !== a).length;
          if (wrong) { fb.className = 'feedback bad'; fb.textContent = `The glass fogs over. ${wrong} of your answers ${wrong > 1 ? 'are' : 'is'} wrong.`; return; }
          state.solved.mirror = true; state.clues.note = true; setDigit(3, '4');
          root.querySelector('.facts').remove(); root.querySelector('#mirror-check').remove(); fb.remove();
          root.querySelector('.hint-box, [data-hint]')?.remove();
          root.insertAdjacentHTML('beforeend', `<p>The ghostly face shrieks and shatters into mist. "Myth-ter Mystery strikes again!"</p>
            ${reward('4', '<strong>Digit #4 is 4.</strong> Four facts, two myths, zero ghosts fooled.')}
            ${reward('3', `<strong>Clue found:</strong> Something drops out of the frame. ${CLUE_TEXT.note}`)}`);
          quip('Velma', 'Four facts! The last digit is 4.');
        });
      });
    },

    door() {
      if (state.solved.door) return puzzles.unmask();
      const hint = 'Digits come from: #1 the old map, #2 the Owner\'s Manual, #3 the marble busts, #4 the haunted mirror. Found digits appear in the Exit code bar at the top.';
      state.keypad = '';
      openModal(`<h2>The Exit Doors</h2><p class="who">Fred: "A 4-digit keypad. Classic."</p>
        <p>Green light leaks from under the heavy doors. Enter the exit code in order, Digit #1 to #4.</p>
        <div class="keypad-display">${[0, 1, 2, 3].map(i => `<b data-k="${i}"></b>`).join('')}</div>
        <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('')}<button class="k-clr" data-n="clr">Clear</button><button data-n="0">0</button><button class="k-ok" data-n="ok" aria-label="Enter code">✓</button></div>
        <div class="feedback" aria-live="polite" style="text-align:center"></div>
        ${hintBlock('door', hint)}`, (root) => {
        wireHint(root, 'door', hint);
        const fb = root.querySelector('.feedback');
        const show = () => root.querySelectorAll('[data-k]').forEach((b, i) => b.textContent = state.keypad[i] || '');
        const press = (n) => {
          if (n === 'clr') { state.keypad = ''; show(); fb.textContent = ''; return; }
          if (n === 'ok') {
            if (state.keypad.length < 4) { fb.className = 'feedback bad'; fb.textContent = 'The code needs 4 digits.'; return; }
            if (state.keypad === CODE) {
              state.solved.door = true; renderHud();
              const g = $('#ghost-flash'); g.classList.remove('go'); void g.offsetWidth; g.classList.add('go');
              setTimeout(() => puzzles.unmask(), 700);
            } else {
              fb.className = 'feedback bad';
              fb.textContent = pick(['Ruh-roh. Wrong code. The keypad flashes red.', 'Bzzzt. Like, nope, man.', 'Wrong code. Somewhere in the walls, the phantom cackles.']);
              state.keypad = ''; setTimeout(show, 400);
            }
            return;
          }
          if (state.keypad.length < 4) { state.keypad += n; show(); }
        };
        root.querySelectorAll('.keypad button').forEach(b => b.addEventListener('click', () => press(b.dataset.n)));
        keypadHandler = (e) => {
          if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); }
          else if (e.key === 'Enter') { press('ok'); e.preventDefault(); }
          else if (e.key === 'Backspace') { state.keypad = state.keypad.slice(0, -1); show(); e.preventDefault(); }
        };
      });
    },

    unmask() {
      const clueItems = Object.entries(CLUE_TEXT).map(([k, t]) => state.clues[k] ? `<li>${t}</li>` : `<li class="missing">Clue not found yet</li>`).join('');
      const suspects = [
        { id: 'penny', name: 'Penny Pinchwick', tag: 'Project Manager', from: 'Vancouver, WA (flies into Fresno often)', known: 'Shouting out her crew by name in every meeting', motto: '"Owners show up for each other."' },
        { id: 'baron', name: 'Baron Von Buyout', tag: 'Out-of-Town Investor', from: 'Flew in from the Portland area this week', known: 'Taking credit for deals his team closed', motto: '"Why share a company when you can own it all?"' },
        { id: 'count', name: 'Count Creditula', tag: 'Self-Proclaimed Genius', from: 'Drove up from Bakersfield, CA', known: 'Hogging the spotlight at every meeting', motto: '"Mine! All mine! Mwahaha."' },
        { id: 'holly', name: 'Dr. Holly Holdings', tag: 'Visiting Consultant', from: 'Took the train from Redlands, CA', known: 'Celebrating her team\'s wins louder than her own', motto: '"Why share when you can own it all?"' },
      ];
      openModal(`<h2>The doors burst open, and there's the phantom</h2><p class="who">Fred: "Gang, let's unmask this ghost."</p>
        <p>A glowing phantom blocks the hallway, clutching a stack of stolen ESOP statements. Before you can escape, figure out who's under the sheet. Your clue notebook:</p>
        <ul class="clue-list">${clueItems}</ul>
        <p><strong>Who is the phantom?</strong> Pick the suspect who matches <u>all three</u> clues. A wrong accusation costs ${WRONG_SUSPECT_PENALTY} seconds.</p>
        <div class="suspects">${suspects.map(s => `<button class="suspect" data-s="${s.id}"><span class="tag">${s.tag}</span><strong>${s.name}</strong><dl><dt>Traveled from</dt><dd>${s.from}</dd><dt>Known for</dt><dd>${s.known}</dd><dt>Favorite saying</dt><dd>${s.motto}</dd></dl></button>`).join('')}</div>
        <div class="feedback" aria-live="polite"></div>`, (root) => {
        const fb = root.querySelector('.feedback');
        const lines = {
          penny: 'Red herring. Penny flies in from the Vancouver area, but she shares every bit of credit and believes in shared ownership. She\'s a true owner, not a ghost.',
          count: 'Wrong suspect. The Count hogs credit and wants it all, but he drove up from Bakersfield. No boarding pass, no case.',
          holly: 'Not her. Holly has the greedy motto, but she shares credit and came by train from Redlands. Her alibi is on track.',
        };
        root.querySelectorAll('.suspect').forEach(b => b.addEventListener('click', () => {
          if (b.dataset.s === 'baron') { closeModal(); win(); return; }
          penalize(WRONG_SUSPECT_PENALTY);
          b.disabled = true; b.style.opacity = .4;
          fb.className = 'feedback bad'; fb.textContent = `${lines[b.dataset.s]} (−${WRONG_SUSPECT_PENALTY} sec)`;
        }));
      });
    },

    window() { quip('Daphne', 'The Mystery Machine is right out there. So close, and yet so locked in.'); },
    table() { quip('Shaggy', 'Like, a boardroom with zero snacks? That\'s the scariest thing in this whole building.'); },
    shelf() { quip('Velma', 'Sixty years of project binders. Fascinating, but no clues here. Try the busts above.'); },
  };

  function showNotebook() {
    const items = Object.entries(CLUE_TEXT).map(([k, t]) => state.clues[k] ? `<li>${t}</li>` : `<li class="missing">Clue not found yet</li>`).join('');
    openModal(`<h2>Clue Notebook</h2><p class="who">Velma's notes</p>
      <p><strong>Exit code so far:</strong> <span style="font-variant-numeric:tabular-nums;letter-spacing:.2em">${state.digits.map(d => d ?? '?').join(' ')}</span></p>
      <p><strong>Phantom clues:</strong></p><ul class="clue-list">${items}</ul>
      <p style="font-size:14px;color:var(--muted)">${state.lantern ? 'Inventory: The Founder\'s Lantern.' : 'Inventory: empty. Shaggy ate the flashlight batteries. Don\'t ask.'}</p>`);
  }

  /* ---------- End states ---------- */
  const stopTimer = () => { clearInterval(tick); tick = null; };
  const esc = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function win() {
    if (state.over) return;
    state.over = true; stopTimer();
    const left = remaining();
    const used = TOTAL_SECONDS - left;
    const rank = left >= 420 ? 'Velma-Level Genius' : left >= 180 ? 'Fred-Approved Trap Setter' : 'Shaggy-Style Close Call';
    $('#end-art').style.backgroundImage = "url('assets/win.webp')";
    $('#end-content').className = 'end-content win';
    $('#end-content').innerHTML = `
      <h2 id="end-title">Scooby-Dooby-DONE!</h2>
      <p>You unmasked the phantom and escaped with <strong>${fmt(left)}</strong> to spare. That's a fang-tastic bit of sleuthing, and proof that you've got a real stake in this place.</p>
      <p class="villain">Off comes the mask: it's <strong>Baron Von Buyout</strong>. He haunted Founders' Hall hoping to scare BSK's employee-owners into selling out so he could own the whole company himself. "And I would've gotten away with it, too, if it weren't for you meddling employee-owners!" Turns out you can't buy out 220+ owners who show up for each other.</p>
      <div class="cert">
        <div class="cert-meta">Certified Mystery-Solving Employee-Owner</div>
        <div class="cert-name">${esc(state.name || 'Mystery Inc. Employee-Owner')}</div>
        <div class="cert-meta">Escaped Founders' Hall in ${fmt(used)} · ${state.hintsUsed} hint${state.hintsUsed === 1 ? '' : 's'} used</div>
        <div class="rank">${rank}</div>
      </div>
      <p style="font-size:14px;color:var(--muted)">Snap a screenshot of your certificate and share it in the Spooktacular Week post.</p>
      <div class="end-actions"><button class="btn btn-primary" data-restart>Solve it again</button></div>`;
    $('#end').hidden = false;
    const r = $('[data-restart]'); r.focus(); r.addEventListener('click', restart);
  }

  function lose() {
    if (state.over) return;
    state.over = true; stopTimer(); closeModal();
    const solvedCount = Object.values(state.solved).filter(Boolean).length;
    $('#end-art').style.backgroundImage = "url('assets/lose.webp')";
    $('#end-content').className = 'end-content lose';
    $('#end-content').innerHTML = `
      <h2 id="end-title">Ruh-Roh! Time's Up!</h2>
      <p>${pick(['Zoinks, you\'ve been ghosted. The phantom slipped away with the ESOP statements, and this case just went cold.', 'The clock struck midnight and the phantom got away with it. Looks like this mystery is going to haunt you a little longer.'])}</p>
      <p class="villain">You solved <strong>${solvedCount} of 6</strong> puzzles before the doors locked for good. Like, don't sweat it, man. Even Mystery Inc. needs a few takes, and the Scooby Snacks are still in the van.</p>
      <div class="end-actions"><button class="btn btn-primary" data-restart>Ghost back in and try again</button></div>`;
    $('#end').hidden = false;
    const r = $('[data-restart]'); r.focus(); r.addEventListener('click', restart);
  }

  /* ---------- Flow ---------- */
  function start() {
    state = freshState();
    state.name = $('#player-name').value.trim().slice(0, 40);
    state.endAt = Date.now() + TOTAL_SECONDS * 1000;
    $('#screen-title').classList.remove('active');
    $('#screen-game').classList.add('active');
    $('#end').hidden = true;
    renderHud(); renderTimer();
    stopTimer(); tick = setInterval(renderTimer, 250);
    startFx('fx-stage', 26);
    setTimeout(() => quip('Fred', 'The doors locked behind us! Let\'s split up and look for clues, gang. Hover over or tap anything suspicious.', 5200), 400);
    setTimeout(() => $$('.hs:not(.flavor)').forEach(h => h.classList.add('hint-pulse')), 600);
  }
  function restart() { $('#end').hidden = true; closeModal(); start(); }

  $('#btn-start').addEventListener('click', start);
  $('#player-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
  $('#btn-notebook').addEventListener('click', () => { if (state && !state.over) showNotebook(); });
  $$('[data-obj]').forEach(el => el.addEventListener('click', () => {
    if (!state || state.over) return;
    el.classList.remove('hint-pulse');
    puzzles[el.dataset.obj]?.();
  }));

  /* ---------- Ambient particles (dust + ecto sparks) ---------- */
  const fxRuns = {};
  function startFx(id, count) {
    const cv = document.getElementById(id);
    if (!cv || fxRuns[id] || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    fxRuns[id] = true;
    const ctx = cv.getContext('2d');
    let w, h, dpr;
    const resize = () => { dpr = Math.min(2, devicePixelRatio || 1); w = cv.clientWidth; h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); addEventListener('resize', resize);
    const ps = Array.from({ length: count }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.8 + .4, s: Math.random() * .00025 + .00008, d: Math.random() * Math.PI * 2, g: Math.random() < .35 }));
    const loop = (t) => {
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        p.y -= p.s; p.x += Math.sin(t / 2400 + p.d) * .00025;
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        const a = .35 + .35 * Math.sin(t / 700 + p.d);
        ctx.beginPath(); ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.g ? `rgba(100,255,168,${a})` : `rgba(255,220,170,${a * .7})`;
        ctx.shadowColor = p.g ? 'rgba(100,255,168,.9)' : 'rgba(255,200,120,.6)'; ctx.shadowBlur = 8;
        ctx.fill();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  startFx('fx-title', 40);
})();
