/* Chinesisch: Liste, Karteikarten, Quiz, Schreiben, Zuordnen und ein gemischter Modus.
   Jede Aufgabe hat eine Frage- und eine Antwortseite - Englisch, Zeichen oder
   Pinyin; im Mix wird aus den aktivierten Arten zufaellig gezogen. */
(function () {
    'use strict';

    const LESSONS = window.BOOK2_LESSONS || [];
    const DATA    = window.BOOK2_ENTRIES || {};
    const VOICES  = window.ZH_VOICES || [];
    const L       = window.ZHLearn;
    const TTS_DIR = '../assets/audio/tts/';
    const K_LESSON = 'zh-lesson';
    const K_VIEW   = 'zh-view';

    const $ = (id) => document.getElementById(id);
    const audio = $('audio');

    const TYPES = [
        { c: 'card',  label: 'Karteikarte' },
        { c: 'quiz',  label: 'Quiz' },
        { c: 'write', label: 'Schreiben' },
        { c: 'match', label: 'Zuordnen' },
    ];
    const DIRS  = [
        { c: 'en2zh', label: 'EN → 中文' },
        { c: 'zh2en', label: '中文 → EN' },
        { c: 'zh2py', label: '汉字 → Pinyin' },
        { c: 'py2zh', label: 'Pinyin → 汉字' },
    ];
    const FORMS = [{ c: 'zh', label: '汉字' }, { c: 'py', label: 'Pinyin' }];
    // Zielform betrifft nur die Richtungen, die die chinesische Seite offen lassen.
    const FORM_DIRS = ['en2zh', 'zh2en'];

    // Pro Seite: Kuerzel fuer CSS-Klassen, Sprachauszeichnung, Beschriftung.
    const SIDE_CLASS = { de: 'en', zh: 'zh', py: 'py' };
    const SIDE_LANG  = { zh: 'zh', py: 'zh-Latn' };
    const SIDE_NAME  = { de: 'EN', zh: '汉字', py: 'Pinyin' };
    const WRITE_ASK  = {
        de: 'Übersetze ins Englische',
        py: 'Schreibe das Pinyin',
        zh: 'Schreibe die Zeichen',
    };
    const SECTIONS = { card: 'view-cards', quiz: 'view-quiz', write: 'view-write', match: 'view-match' };
    // Die Schalter heissen 'cards', der Aufgabentyp 'card' - hier uebersetzt.
    const VIEW2TYPE = { cards: 'card', quiz: 'quiz', write: 'write', match: 'match' };

    let lesson = 1;
    let view = 'list';
    let task = null;          // { type, dir, form, entry | entries }
    let flipped = false;
    let listPlaying = null;
    let score = { right: 0, done: 0 };

    try {
        const v = parseInt(localStorage.getItem(K_LESSON), 10);
        if (v >= 1 && v <= 100) lesson = v;
    } catch (e) {}

    const entriesOf = (n) => (DATA[n] && DATA[n].entries) ? DATA[n].entries : [];
    const poolNow   = () => L.pool(DATA, lesson);

    // ---------- Wiedergabe ----------
    function pickVoice(e) {
        const p = (e.v && e.v.length) ? e.v : VOICES.map(v => v.c);
        return p.length ? p[Math.floor(Math.random() * p.length)] : null;
    }
    function playEntry(e, row, btn) {
        if (!e) return;
        const code = pickVoice(e);
        if (!code || !e.k) return speak(e, row, btn);
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        audio.src = TTS_DIR + code + '/' + e.k + '.mp3';
        audio.play().catch(() => speak(e, row, btn));
        if (row && btn) markRow(row, btn);
    }
    function speak(e, row, btn) {
        const synth = window.speechSynthesis;
        if (!synth || !e || !e.zh) return;
        synth.cancel(); audio.pause();
        const u = new SpeechSynthesisUtterance(e.zh);
        u.lang = 'zh-CN'; u.rate = 0.85;
        const v = synth.getVoices().find(x => /^zh/i.test(x.lang));
        if (v) u.voice = v;
        u.onend = u.onerror = clearRow;
        if (row && btn) markRow(row, btn);
        synth.speak(u);
    }
    function markRow(row, btn) {
        clearRow();
        listPlaying = { row: row, btn: btn };
        row.classList.add('playing'); btn.classList.add('playing');
    }
    function clearRow() {
        if (!listPlaying) return;
        listPlaying.row.classList.remove('playing');
        listPlaying.btn.classList.remove('playing');
        listPlaying = null;
    }
    audio.addEventListener('ended', clearRow);
    audio.addEventListener('error', clearRow);

    /** Ein Element fuer den Text einer Seite: Basisklasse plus Seitenklasse,
        damit Zeichen, Pinyin und Englisch unterschiedlich gesetzt werden. */
    function sideEl(tag, base, side, entry) {
        const el = document.createElement(tag);
        el.className = base + ' ' + base + '-' + SIDE_CLASS[side];
        el.textContent = L.text(entry, side);
        if (SIDE_LANG[side]) el.lang = SIDE_LANG[side];
        return el;
    }

    function speaker(onClick) {
        const b = document.createElement('button');
        b.className = 'play';
        b.setAttribute('aria-label', 'Anhören');
        b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';
        b.addEventListener('click', onClick);
        return b;
    }

    // ---------- Liste ----------
    function renderList() {
        const wrap = $('vocab');
        wrap.innerHTML = '';
        const list = entriesOf(lesson);
        if (!list.length) {
            wrap.innerHTML = '<p class="empty">Für diese Lektion liegen keine Vokabeln vor.</p>';
            return;
        }
        list.forEach(e => {
            const row = document.createElement('div');
            row.className = 'row';
            const en = document.createElement('div');
            en.className = 'en'; en.textContent = e.de || '';
            const zh = document.createElement('div');
            zh.className = 'zh';
            const h = document.createElement('div');
            h.className = 'hanzi'; h.lang = 'zh'; h.textContent = e.zh || '';
            zh.appendChild(h);
            if (e.py) {
                const py = document.createElement('div');
                py.className = 'pinyin'; py.textContent = e.py;
                zh.appendChild(py);
            }
            const btn = speaker(() => playEntry(e, row, btn));
            btn.title = 'Anhören – zufällige Stimme';
            row.append(en, zh, btn);
            wrap.appendChild(row);
        });
    }

    // ---------- Aufgabensteuerung ----------
    function showSection(type) {
        $('vocab').classList.toggle('hide', true);
        Object.keys(SECTIONS).forEach(t => $(SECTIONS[t]).classList.toggle('hide', t !== type));
    }

    function nextTask() {
        const all = poolNow();
        if (!all.length) return renderEmpty();
        const t = L.task(view === 'mix' ? null : (VIEW2TYPE[view] || 'card'), Math.random);
        // Vokabeln ohne Text auf einer der beiden Seiten taugen fuer diese
        // Richtung nicht; bleibt nichts uebrig, gilt wieder der ganze Pool.
        const pool = all.filter(e => L.text(e, t.ask) && L.text(e, t.ans));
        t.pool = pool.length ? pool : all;
        if (t.type === 'match') {
            const n = Math.min(5, Math.floor(t.pool.length / 2));
            // Beide Spalten muessen unterscheidbar sein - sonst ist die Runde unlösbar
            const label = (e) => L.text(e, t.ask) + '\u0000' + L.text(e, t.ans);
            const picked = n >= 2 ? L.sample(t.pool, n, Math.random, label) : [];
            if (picked.length < 2) t.type = 'quiz';
            else t.entries = picked;
        }
        if (t.type !== 'match') {
            if (t.type === 'quiz' && t.pool.length < 4) t.type = 'card';
            t.entry = L.next(t.pool, Math.random);
        }
        task = t;
        flipped = false;
        showSection(t.type);
        if (t.type === 'match') renderMatch();
        else if (t.type === 'quiz') renderQuiz();
        else if (t.type === 'write') renderWrite();
        else renderCard();
        updateStats();
    }

    function renderEmpty() {
        task = null;
        const type = view === 'mix' ? 'card' : (VIEW2TYPE[view] || 'card');
        showSection(type);
        const msg = '<p class="empty">Noch keine Lektion durchgearbeitet.<br>'
                  + 'Hake oben eine Lektion ab oder stelle den Umfang auf „nur diese Lektion".</p>';
        ['card', 'quiz-card', 'match-grid'].forEach(id => { if ($(id)) $(id).innerHTML = ''; });
        const host = { card: 'card', quiz: 'quiz-card', write: 'write-prompt', match: 'match-grid' }[type];
        $(host).innerHTML = msg;
    }

    function answer(correct) {
        if (task && task.entry) L.record(task.entry.k, correct);
        score.done++;
        if (correct) score.right++;
        updateStats();
    }

    function updateStats() {
        const s = L.summary(poolNow());
        $('pool-stat').textContent = s.total + ' Vokabeln · ' + s.seen + ' geübt';
        $('score').textContent = score.done
            ? score.right + ' von ' + score.done + ' richtig in dieser Sitzung' : '';
    }

    // ---------- Karteikarte ----------
    function renderCard() {
        const box = $('card'); box.innerHTML = '';
        const e = task.entry;
        const rest = L.rest(task.ask, task.ans);   // dritte Seite als Zusatz

        const tag = document.createElement('div');
        tag.className = 'lesson-tag';
        tag.textContent = 'Lektion ' + e.lesson + ' · '
                        + SIDE_NAME[task.ask] + ' → ' + SIDE_NAME[task.ans];

        const front = sideEl('div', 'front', task.ask, e);

        const back = document.createElement('div');
        back.className = 'back' + (flipped ? '' : ' hide-until-flip');
        back.appendChild(sideEl('div', 'ans', task.ans, e));
        if (L.text(e, rest)) back.appendChild(sideEl('div', 'extra', rest, e));

        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = flipped ? 'Wusstest du es?' : 'Klicken zum Umdrehen · Leertaste';
        box.append(tag, front, back, hint);
    }

    // ---------- Quiz ----------
    function renderQuiz() {
        const box = $('quiz-card'), opts = $('quiz-opts');
        box.innerHTML = ''; opts.innerHTML = '';
        const e = task.entry;

        box.appendChild(sideEl('div', 'q', task.ask, e));
        const sp = speaker(() => playEntry(e));
        sp.style.marginTop = '10px';
        box.appendChild(sp);

        const choices = L.distractors(task.pool, e, 3, Math.random, task.ans).concat([e]);
        for (let i = choices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = choices[i]; choices[i] = choices[j]; choices[j] = t;
        }
        choices.forEach(c => {
            const b = document.createElement('button');
            b.className = 'qopt';
            b.appendChild(sideEl('span', 'opt', task.ans, c));
            b.addEventListener('click', () => {
                const right = c.k === e.k;
                answer(right);
                Array.prototype.forEach.call(opts.children, x => { x.disabled = true; });
                Array.prototype.forEach.call(opts.children, (x, i2) => {
                    if (choices[i2].k === e.k) x.classList.add('right');
                });
                if (!right) b.classList.add('wrong');
                playEntry(e);
                setTimeout(nextTask, right ? 850 : 1800);
            });
            opts.appendChild(b);
        });
    }

    // ---------- Schreiben ----------
    function renderWrite() {
        const e = task.entry;
        const prompt = $('write-prompt');
        prompt.className = 'prompt prompt-' + SIDE_CLASS[task.ask];
        prompt.textContent = L.text(e, task.ask);
        prompt.lang = SIDE_LANG[task.ask] || '';
        $('write-ask').textContent = WRITE_ASK[task.ans];
        const inp = $('write-input');
        inp.value = ''; inp.disabled = false;
        inp.classList.remove('right', 'wrong');
        $('write-solution').innerHTML = '';
        $('write-check').textContent = 'Prüfen';
        if (inp.focus) inp.focus();
    }

    function checkWrite() {
        if (!task || !task.entry) return;
        const inp = $('write-input');
        if (inp.disabled) { nextTask(); return; }        // zweiter Klick: weiter
        const e = task.entry;
        const r = L.checkWritten(inp.value, e, task.ans);
        const ok = r.ok, want = r.want;
        answer(ok);
        inp.disabled = true;
        inp.classList.add(ok ? 'right' : 'wrong');
        const sol = $('write-solution');
        sol.innerHTML = '';
        if (ok) {
            sol.textContent = 'Richtig';
        } else {
            sol.appendChild(document.createTextNode('Richtig wäre: '));
            const b = document.createElement('b');
            b.textContent = want;
            if (SIDE_LANG[task.ans]) b.lang = SIDE_LANG[task.ans];
            sol.appendChild(b);
            const undo = document.createElement('button');
            undo.className = 'btn';
            undo.style.marginLeft = '12px';
            undo.textContent = 'War doch richtig';
            undo.addEventListener('click', () => {
                L.record(e.k, true);
                score.right++;
                updateStats();
                nextTask();
            });
            sol.appendChild(undo);
        }
        $('write-check').textContent = 'Weiter';
        playEntry(e);
    }

    // ---------- Zuordnen ----------
    let matchSel = null, matchOpen = 0;
    function renderMatch() {
        const grid = $('match-grid');
        grid.innerHTML = '';
        const left = task.entries.slice();
        const right = task.entries.slice();
        for (let i = right.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = right[i]; right[i] = right[j]; right[j] = t;
        }
        matchSel = null;
        matchOpen = left.length;

        const make = (e, isLeft) => {
            const b = document.createElement('button');
            b.className = 'mitem';
            b.dataset.side = isLeft ? 'l' : 'r';
            b.appendChild(sideEl('span', 'm', isLeft ? task.ask : task.ans, e));
            b.addEventListener('click', () => onMatch(b, e, isLeft));
            return b;
        };
        // Zeilenweise einfuegen: links, rechts, links, rechts ...
        for (let i = 0; i < left.length; i++) {
            grid.appendChild(make(left[i], true));
            grid.appendChild(make(right[i], false));
        }
    }

    function onMatch(btn, entry, isLeft) {
        if (btn.disabled) return;
        if (!matchSel) {
            if (!isLeft) return;                    // Auswahl beginnt links
            matchSel = { btn: btn, entry: entry };
            btn.classList.add('sel');
            playEntry(entry);
            return;
        }
        if (isLeft) {                               // Auswahl wechseln
            matchSel.btn.classList.remove('sel');
            matchSel = { btn: btn, entry: entry };
            btn.classList.add('sel');
            playEntry(entry);
            return;
        }
        const right = entry.k === matchSel.entry.k;
        L.record(matchSel.entry.k, right);
        score.done++;
        if (right) score.right++;
        if (right) {
            matchSel.btn.classList.remove('sel');
            matchSel.btn.classList.add('done'); matchSel.btn.disabled = true;
            btn.classList.add('done'); btn.disabled = true;
            matchOpen--;
            if (!matchOpen) setTimeout(nextTask, 700);
        } else {
            btn.classList.add('miss');
            const sel = matchSel.btn;
            setTimeout(() => { btn.classList.remove('miss'); sel.classList.remove('sel'); }, 650);
        }
        matchSel = null;
        updateStats();
    }

    // ---------- Einstellungen ----------
    /** Die Zielform wirkt nur auf EN <-> 中文; sonst legt die Richtung
        beide Seiten schon fest. Dann wird die Zeile ausgegraut. */
    function updateFormRow() {
        const used = L.opts.dirs.some(d => FORM_DIRS.indexOf(d) !== -1);
        $('row-forms').classList.toggle('off', !used);
    }

    function buildToggles(hostId, items, key, onChange) {
        const host = $(hostId);
        host.innerHTML = '';
        items.forEach(it => {
            const b = document.createElement('button');
            b.className = 'tog' + (L.opts[key].indexOf(it.c) !== -1 ? ' on' : '');
            b.dataset.val = it.c;
            if (/[一-鿿]/.test(it.label)) {
                const s2 = document.createElement('span');
                s2.className = 'zh'; s2.textContent = it.label;
                b.appendChild(s2);
            } else b.textContent = it.label;
            b.addEventListener('click', () => {
                const arr = L.opts[key];
                const i = arr.indexOf(it.c);
                if (i === -1) arr.push(it.c);
                else if (arr.length > 1) arr.splice(i, 1);   // eine Option muss bleiben
                L.saveOpts();
                b.classList.toggle('on', arr.indexOf(it.c) !== -1);
                if (onChange) onChange();
                if (view !== 'list') nextTask();
            });
            host.appendChild(b);
        });
    }

    function setView(name) {
        view = name;
        try { localStorage.setItem(K_VIEW, name); } catch (e) {}
        score = { right: 0, done: 0 };
        $('view-select').value = name;
        if (name === 'list') {
            $('vocab').classList.remove('hide');
            Object.keys(SECTIONS).forEach(t => $(SECTIONS[t]).classList.add('hide'));
            $('score').textContent = '';
            renderList();
            updateStats();
        } else {
            L.recent = [];
            nextTask();
        }
    }

    function updateDone() {
        const on = L.isDone(lesson);
        $('lesson-done').checked = on;
        $('done-label').classList.toggle('on', on);
        $('done-stat').textContent = L.done.size + ' von 100 Lektionen durchgearbeitet';
    }

    function setLesson(n) {
        lesson = n;
        audio.pause(); clearRow();
        $('lesson-select').value = n;
        $('prev').disabled = n <= 1;
        $('next').disabled = n >= 100;
        try { localStorage.setItem(K_LESSON, String(n)); } catch (e) {}
        updateDone();
        if (view === 'list') { renderList(); updateStats(); } else nextTask();
    }

    // ---------- Aufbau ----------
    const sel = $('lesson-select');
    LESSONS.forEach(l => {
        const o = document.createElement('option');
        o.value = l.n; o.textContent = l.n + ' — ' + l.title;
        sel.appendChild(o);
    });
    sel.addEventListener('change', () => setLesson(parseInt(sel.value, 10)));
    $('prev').addEventListener('click', () => lesson > 1 && setLesson(lesson - 1));
    $('next').addEventListener('click', () => lesson < 100 && setLesson(lesson + 1));
    $('lesson-done').addEventListener('change', () => {
        L.toggleLesson(lesson); updateDone();
        if (view !== 'list') nextTask(); else updateStats();
    });

    $('view-select').addEventListener('change', () => setView($('view-select').value));

    $('settings-toggle').addEventListener('click', () => {
        const p = $('settings-panel');
        p.classList.toggle('hide');
        $('settings-toggle').classList.toggle('open', !p.classList.contains('hide'));
    });

    ['opt-scope', 'opt-mode'].forEach(id => {
        const key = id === 'opt-scope' ? 'scope' : 'mode';
        const el = $(id);
        el.value = L.opts[key];
        el.addEventListener('change', () => {
            L.opts[key] = el.value; L.saveOpts(); L.recent = [];
            if (view !== 'list') nextTask(); else updateStats();
        });
    });
    buildToggles('opt-dirs', DIRS, 'dirs', updateFormRow);
    buildToggles('opt-forms', FORMS, 'forms');
    buildToggles('opt-types', TYPES, 'types');
    updateFormRow();

    $('card').addEventListener('click', () => {
        if (!task || !task.entry) return;
        flipped = !flipped; renderCard();
        if (flipped) playEntry(task.entry);
    });
    $('card-good').addEventListener('click', () => { answer(true); nextTask(); });
    $('card-bad').addEventListener('click', () => { answer(false); nextTask(); });
    $('card-audio').addEventListener('click', () => task && playEntry(task.entry));

    $('write-check').addEventListener('click', checkWrite);
    $('write-skip').addEventListener('click', () => { answer(false); nextTask(); });
    $('write-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); checkWrite(); }
    });
    $('match-new').addEventListener('click', nextTask);

    document.addEventListener('keydown', (e) => {
        if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
        if (!task) return;
        if (task.type === 'card') {
            if (e.code === 'Space') { e.preventDefault(); flipped = !flipped; renderCard(); if (flipped) playEntry(task.entry); }
            else if (e.key === 'ArrowRight') { answer(true); nextTask(); }
            else if (e.key === 'ArrowLeft') { answer(false); nextTask(); }
        }
    });

    updateDone();
    setLesson(lesson);

    // Zuletzt genutzte Ansicht wiederherstellen
    let startView = 'list';
    try {
        const v = localStorage.getItem(K_VIEW);
        const known = ['list', 'cards', 'quiz', 'write', 'match', 'mix'];
        if (v && known.indexOf(v) !== -1) startView = v;
    } catch (e) {}
    setView(startView);
})();
