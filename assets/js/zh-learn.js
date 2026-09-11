/* Lernlogik: Auswahl der Vokabeln, Gewichtung, Sperrliste, Speicherung.
   Bewusst ohne DOM-Bezug, damit sie einzeln testbar bleibt. */
(function (global) {
    'use strict';

    // Jede Aufgabe hat eine Frage- und eine Antwortseite:
    // 'de' = Englisch, 'zh' = Zeichen, 'py' = Pinyin.
    const SIDES = ['de', 'zh', 'py'];
    // Richtungen, die beide Seiten selbst festlegen. Bei EN <-> 中文 kommt
    // die chinesische Seite dagegen aus der Zielform.
    const FIXED_DIRS = {
        zh2py: { ask: 'zh', ans: 'py' },
        py2zh: { ask: 'py', ans: 'zh' },
    };

    const K_DONE  = 'zh-done';     // abgehakte Lektionen
    const K_STATS = 'zh-stats';    // je Vokabel: richtig, falsch, Gewicht
    const K_OPTS  = 'zh-learnopts';

    // Gewicht steuert, wie oft eine Vokabel gezogen wird.
    const W_START = 1.0;
    const W_MIN   = 0.15;   // gekonnte Vokabeln verschwinden nie ganz
    const W_MAX   = 5.0;    // schwierige kleben nicht endlos fest
    const W_RIGHT = 0.55;   // richtig -> seltener
    const W_WRONG = 2.2;    // falsch  -> haeufiger

    function read(k, d) {
        try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : d; }
        catch (e) { return d; }
    }
    function write(k, v) {
        try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    }

    const Learn = {
        done:  new Set(read(K_DONE, [])),
        stats: read(K_STATS, {}),
        opts:  Object.assign({
            mode: 'weighted',      // 'weighted' | 'even'
            scope: 'done',         // 'done' | 'lesson'
            dirs: ['en2zh'],       // Richtungen, aus denen gezogen wird
            forms: ['zh'],         // chinesische Seite bei EN <-> 中文: 'zh' und/oder 'py'
            types: ['card'],       // im Mix aktive Aufgabenarten
        }, read(K_OPTS, {})),
        recent: [],          // zuletzt gezogene Schlüssel (Sperrliste)

        saveDone()  { write(K_DONE, Array.from(this.done)); },
        saveStats() { write(K_STATS, this.stats); },
        saveOpts()  { write(K_OPTS, this.opts); },

        toggleLesson(n) {
            const k = String(n);
            if (this.done.has(k)) this.done.delete(k); else this.done.add(k);
            this.saveDone();
            return this.done.has(k);
        },
        isDone(n) { return this.done.has(String(n)); },

        /** Vokabelpool: entweder die aktuelle Lektion oder alle abgehakten. */
        pool(data, lesson) {
            const take = (n) => (data[n] && data[n].entries ? data[n].entries : [])
                                  .map(e => Object.assign({ lesson: +n }, e));
            if (this.opts.scope === 'lesson') return take(lesson);
            const out = [];
            Object.keys(data).sort((a, b) => a - b).forEach(n => {
                if (this.done.has(String(n))) out.push.apply(out, take(n));
            });
            return out;
        },

        /** Nur lesen - legt keinen Eintrag an. */
        peek(key) {
            return this.stats[key] || { r: 0, f: 0, w: W_START };
        },

        /** Lesen und bei Bedarf anlegen - nur beim Verbuchen einer Antwort. */
        stat(key) {
            if (!this.stats[key]) this.stats[key] = { r: 0, f: 0, w: W_START };
            return this.stats[key];
        },

        /** Antwort verbuchen und Gewicht anpassen. */
        record(key, correct) {
            const s = this.stat(key);
            if (correct) { s.r++; s.w = Math.max(s.w * W_RIGHT, W_MIN); }
            else         { s.f++; s.w = Math.min(s.w * W_WRONG, W_MAX); }
            this.saveStats();
            return s;
        },

        /** Wie viele der zuletzt gezogenen Karten gesperrt bleiben. */
        blockSize(poolSize) {
            return Math.max(0, Math.min(10, Math.floor(poolSize / 3)));
        },

        /** Zieht die nächste Vokabel: gewichtet oder gleichverteilt,
            immer unter Aussparung der zuletzt gezogenen. */
        next(pool, rnd) {
            if (!pool.length) return null;
            rnd = rnd || Math.random;
            const block = this.blockSize(pool.length);
            const blocked = new Set(this.recent.slice(-block));
            let cand = pool.filter(e => !blocked.has(e.k));
            if (!cand.length) cand = pool;          // Pool zu klein: Sperre lockern

            let pick;
            if (this.opts.mode === 'even') {
                pick = cand[Math.floor(rnd() * cand.length)];
            } else {
                const ws = cand.map(e => this.peek(e.k).w);
                const sum = ws.reduce((a, b) => a + b, 0);
                let t = rnd() * sum;
                pick = cand[cand.length - 1];
                for (let i = 0; i < cand.length; i++) {
                    t -= ws[i];
                    if (t <= 0) { pick = cand[i]; break; }
                }
            }
            this.recent.push(pick.k);
            if (this.recent.length > 40) this.recent.shift();
            return pick;
        },

        /** Falsche Antworten fuer das Quiz. Verglichen wird der Text der
            Antwortseite - sonst stuenden zwei gleiche Loesungen zur Wahl. */
        distractors(pool, right, n, rnd, side) {
            rnd = rnd || Math.random;
            side = side || 'de';
            const want = this.text(right, side);
            const others = pool.filter(e => e.k !== right.k && this.text(e, side) !== want);
            const out = [];
            const used = new Set([want]);
            let guard = 0;
            while (out.length < n && others.length && guard++ < 500) {
                const c = others[Math.floor(rnd() * others.length)];
                const t = this.text(c, side);
                if (used.has(t)) continue;
                used.add(t);
                out.push(c);
            }
            return out;
        },

        summary(pool) {
            let r = 0, f = 0, seen = 0;
            pool.forEach(e => {
                const s = this.stats[e.k];
                if (s) { r += s.r; f += s.f; if (s.r + s.f) seen++; }
            });
            return { total: pool.length, seen: seen, right: r, wrong: f };
        },

        resetStats() { this.stats = {}; this.recent = []; this.saveStats(); },

        /** Zufaellige Auswahl aus einer Optionsliste, mit Rueckfall. */
        anyOf(list, fallback, rnd) {
            const a = (list && list.length) ? list : [fallback];
            return a[Math.floor((rnd || Math.random)() * a.length)];
        },

        /** Frage- und Antwortseite einer Richtung. */
        sides(dir, form) {
            if (FIXED_DIRS[dir]) return FIXED_DIRS[dir];
            const zh = form === 'py' ? 'py' : 'zh';
            return dir === 'zh2en' ? { ask: zh, ans: 'de' } : { ask: 'de', ans: zh };
        },

        /** Die dritte Seite, die weder gefragt noch geantwortet wird. */
        rest(ask, ans) { return SIDES.filter(s => s !== ask && s !== ans)[0]; },

        /** Der Text einer Seite. */
        text(entry, side) {
            if (!entry) return '';
            if (side === 'de') return entry.de || '';
            if (side === 'py') return entry.py || '';
            return entry.zh || '';
        },

        /** Beschreibt die naechste Aufgabe: Art, Richtung, beide Seiten. */
        task(forcedType, rnd) {
            const dir  = this.anyOf(this.opts.dirs, 'en2zh', rnd);
            const form = this.anyOf(this.opts.forms, 'zh', rnd);
            const s    = this.sides(dir, form);
            return {
                type: forcedType || this.anyOf(this.opts.types, 'card', rnd),
                dir: dir, form: form, ask: s.ask, ans: s.ans,
            };
        },

        /** Vergleich fuer die Schreibuebung - tolerant gegenueber
            Gross-/Kleinschreibung, Leerzeichen, Satzzeichen und Tonzeichen. */
        normalize(text, side) {
            let s = String(text || '').trim().toLowerCase();
            if (side === 'de') {
                return s.replace(/[^a-z0-9]/g, '').replace(/^(the|a|an)/, '');
            }
            s = s.replace(/[\s\u00a0]+/g, '');
            s = s.replace(/[。，、！？：；．,.!?:;'"()（）\-–—]/g, '');
            if (side === 'py') {
                s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');   // Tonzeichen weg
                s = s.replace(/ü/g, 'v').replace(/u:/g, 'v');
            }
            return s;
        },

        /** Prueft die Eingabe gegen die Antwortseite. Englische Glossen
            listen Varianten mit "/" - jede davon zaehlt als richtig. */
        checkWritten(input, entry, side) {
            const want = this.text(entry, side);
            const got  = this.normalize(input, side);
            if (!want || !got) return { ok: false, want: want };
            const parts = side === 'de' ? [want].concat(want.split('/')) : [want];
            return { ok: parts.some(p => this.normalize(p, side) === got), want: want };
        },

        /** Zieht n Eintraege fuer die Zuordnung.
            keyFn liefert den angezeigten Text; gleiche Texte werden ausgelassen,
            sonst stuenden zwei nicht unterscheidbare Karten nebeneinander. */
        sample(pool, n, rnd, keyFn) {
            rnd = rnd || Math.random;
            const copy = pool.slice();
            const out = [], seen = new Set();
            while (out.length < n && copy.length) {
                const e = copy.splice(Math.floor(rnd() * copy.length), 1)[0];
                const k = keyFn ? keyFn(e) : e.k;
                if (seen.has(k)) continue;
                seen.add(k);
                out.push(e);
            }
            return out;
        },
    };

    global.ZHLearn = Learn;
})(typeof window !== 'undefined' ? window : globalThis);
