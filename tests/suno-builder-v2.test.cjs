const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');

// DOM regression tests, not a browser/layout or a real-device test.
const html = fs.readFileSync(process.env.SUNO_BUILDER_HTML ||
  path.join(__dirname, '..', 'suno-builder-v2-test.html'), 'utf8');
const instrumental = 'instrumental, no vocals';
const female = 'expressive female lead vocals';

function fixture(t, options = {}) {
  const writes = [], downloads = [], timers = [], revoked = [], errors = [];
  const blobs = new Map();
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, {
    url: 'https://example.test/suno-builder-v2-test.html',
    runScripts: 'dangerously',
    virtualConsole: console,
    beforeParse(window) {
      Object.defineProperty(window.navigator, 'clipboard', {value: options.noClipboard ? undefined : {
        writeText: options.writeText || (async text => writes.push(text))
      }});
      window.Blob = Blob;
      window.URL.createObjectURL = blob => {
        if (options.failDownload) throw new Error('Download unavailable');
        const url = 'blob:test-' + blobs.size;
        blobs.set(url, blob);
        return url;
      };
      window.URL.revokeObjectURL = url => revoked.push(url);
      window.HTMLAnchorElement.prototype.click = function () {
        downloads.push({href: this.href, name: this.download, attached: this.isConnected});
      };
      window.setTimeout = (fn, delay) => timers.push({fn, delay});
    }
  });
  t.after(() => {
    dom.window.close();
    assert.deepEqual(errors, [], 'The page must not throw script errors');
  });
  const el = id => dom.window.document.getElementById(id);
  const event = (id, type = 'input') => el(id).dispatchEvent(new dom.window.Event(type, {bubbles: true}));
  const set = (id, value, type = 'input') => {
    if (id === 'tag') el(id).checked = value;
    else el(id).value = String(value);
    event(id, type);
  };
  return {el, set, event, window: dom.window, writes, downloads, timers, revoked, blobs};
}

test('defaults preserve the vocal prompt, branding, controls and counter', t => {
  const {el} = fixture(t);
  const prompt = el('output').value;
  assert.match(prompt, /^Pop ballad, /);
  assert.ok(prompt.includes(female));
  assert.ok(prompt.includes('115 BPM'));
  assert.ok(prompt.includes('short spoken Yanis Music tag at intro and outro'));
  assert.ok(prompt.endsWith('.'));
  assert.ok(prompt.length < 1000);
  assert.ok(el('count').textContent.startsWith(String(prompt.length)));
  assert.equal(el('copy').disabled, false);
  assert.equal(el('save').disabled, false);
});

test('instrumental excludes the spoken tag and restores either vocal preference', t => {
  const {el, set, event} = fixture(t);
  for (const preference of [true, false]) {
    set('voice', female);
    set('tag', preference);
    set('voice', instrumental);
    assert.equal(el('tag').disabled, true);
    assert.equal(el('tag').checked, false);
    assert.equal(el('tag-note').hidden, false);
    assert.ok(el('output').value.includes('instrumental, no vocals'));
    assert.doesNotMatch(el('output').value, /spoken|Yanis Music|chorus|verses/);
    // A stale checkbox state must not reintroduce a vocal instruction.
    el('tag').checked = true;
    event('mood', 'change');
    assert.doesNotMatch(el('output').value, /spoken|Yanis Music/);
    set('voice', female, 'change');
    assert.equal(el('tag').disabled, false);
    assert.equal(el('tag').checked, preference);
    assert.equal(el('output').value.includes('Yanis Music'), preference);
  }
});

test('all 2640 style, voice, dynamics and tag combinations remain consistent', t => {
  const {el, set} = fixture(t);
  const values = id => Array.from(el(id).options, option => option.value);
  // Use longest instrument/mood phrases to stress the prompt-length budget.
  for (const id of ['inst', 'mood']) set(id, values(id).sort((a, b) => b.length - a.length)[0]);
  let cases = 0, maxLength = 0;
  for (const a of values('genre')) for (const b of values('fusion')) {
    set('genre', a);
    set('fusion', b);
    for (const voice of values('voice')) for (const energy of values('energy')) for (const tag of [false, true]) {
      set('voice', female);
      set('tag', tag);
      set('voice', voice);
      set('energy', energy);
      const text = el('output').value;
      assert.ok(text.startsWith(a + (b && b !== a ? ' with ' + b + ' influences, ' : ', ')));
      assert.ok(text.includes(voice));
      assert.ok(text.includes(el('inst').value));
      assert.ok(text.includes(el('mood').value));
      assert.equal(text.includes('Yanis Music'), tag && voice !== instrumental);
      if (voice === instrumental) assert.doesNotMatch(text, /spoken|chorus|verses|lead vocals|duet/);
      else assert.ok(text.includes(energy));
      assert.doesNotMatch(text, /undefined|NaN|, ,/);
      assert.ok(text.length <= 1000);
      assert.equal(el('copy').disabled, false);
      assert.equal(el('save').disabled, false);
      maxLength = Math.max(maxLength, text.length);
      cases++;
    }
  }
  assert.equal(cases, 2640);
  t.diagnostic(`2640 combinations; maximum prompt length ${maxLength} characters`);
});

test('all 42 instrument and mood pairs are reflected in the prompt', t => {
  const {el, set} = fixture(t);
  for (const instrument of Array.from(el('inst').options, x => x.value)) {
    for (const mood of Array.from(el('mood').options, x => x.value)) {
      set('inst', instrument, 'change');
      set('mood', mood, 'change');
      assert.ok(el('output').value.includes(instrument));
      assert.ok(el('output').value.includes(mood));
    }
  }
});

test('duplicate styles are deduplicated with an explanatory warning', t => {
  const {el, set} = fixture(t);
  set('genre', 'Eurodisco');
  set('fusion', 'Eurodisco');
  assert.equal(el('output').value.split('Eurodisco').length - 1, 1);
  assert.match(el('warning').textContent, /совпадают/);
  set('fusion', '');
  assert.equal(el('warning').textContent, '');
});

test('Jersey Club tempo and experimental-pair warnings work in both positions', t => {
  const {el, set} = fixture(t);
  for (const [a, b] of [['Jersey club', 'Acoustic folk'], ['Acoustic folk', 'Jersey club']]) {
    set('genre', a);
    set('fusion', b);
    set('bpm', 114);
    assert.match(el('warning').textContent, /нетипичен/);
    assert.match(el('warning').textContent, /экспериментальное/);
    set('bpm', 115);
    assert.doesNotMatch(el('warning').textContent, /нетипичен/);
    assert.equal(el('copy').disabled, false, 'Advisory warnings must not block generation');
  }
});

test('every integer BPM from 50 through 200 is preserved exactly', t => {
  const {el, set} = fixture(t);
  for (let bpm = 50; bpm <= 200; bpm++) {
    set('bpm', bpm);
    assert.ok(el('output').value.includes(', ' + bpm + ' BPM, '));
    assert.equal(el('bpm').value, String(bpm));
    assert.equal(el('bpm').getAttribute('aria-invalid'), 'false');
    assert.equal(el('copy').disabled, false);
    assert.equal(el('save').disabled, false);
  }
});

test('invalid BPM never silently falls back or permits copy/export', async t => {
  const {el, set, writes, downloads} = fixture(t);
  for (const bpm of ['', '49', '201', '0', '-1', '115.5', 'abc', 'NaN', 'Infinity', '1e309']) {
    set('bpm', bpm);
    assert.equal(el('output').value, '', 'No substitute or stale prompt for ' + bpm);
    assert.match(el('warning').textContent, /50.*200/);
    assert.equal(el('bpm').getAttribute('aria-invalid'), 'true');
    assert.equal(el('copy').disabled, true);
    assert.equal(el('save').disabled, true);
    await el('copy').onclick();
    el('save').onclick();
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(downloads, []);
  set('bpm', '128');
  assert.ok(el('output').value.includes('128 BPM'));
  assert.equal(el('copy').disabled, false);
  assert.equal(el('save').disabled, false);
});

test('copy writes the exact current prompt and resets its status after editing', async t => {
  const {el, set, writes} = fixture(t);
  set('voice', instrumental);
  set('fusion', 'Synth pop');
  const expected = el('output').value;
  await el('copy').onclick();
  assert.deepEqual(writes, [expected]);
  assert.match(el('copy').textContent, /Скопировано/);
  set('bpm', 130);
  assert.equal(el('copy').textContent, 'Копировать промпт');
  assert.equal(el('output-status').textContent, '');
});

for (const mode of ['missing', 'denied']) {
  test(`clipboard ${mode}: manual fallback selects the whole prompt without claiming success`, async t => {
    const {el, window} = fixture(t, mode === 'missing' ? {noClipboard: true} : {
      writeText: async () => { throw new Error('NotAllowedError'); }
    });
    await el('copy').onclick();
    assert.equal(window.document.activeElement, el('output'));
    assert.equal(el('output').selectionStart, 0);
    assert.equal(el('output').selectionEnd, el('output').value.length);
    assert.match(el('output-status').textContent, /вручную|Автокопирование недоступно/);
    assert.doesNotMatch(el('copy').textContent, /Скопировано/);
  });
}

for (const result of ['resolve', 'reject']) {
  test(`late clipboard ${result} cannot label a changed prompt as copied`, async t => {
    let complete;
    const {el, set} = fixture(t, {writeText: () => new Promise((resolve, reject) => {
      complete = result === 'resolve' ? resolve : () => reject(new Error('Denied'));
    })});
    const pending = el('copy').onclick();
    set('bpm', 130);
    complete();
    await pending;
    assert.equal(el('copy').textContent, 'Копировать промпт');
    assert.equal(el('output-status').textContent, '');
  });
}

test('TXT is an exact UTF-8 prompt with a filename and delayed URL cleanup', async t => {
  const {el, set, downloads, blobs, timers, revoked, window} = fixture(t);
  set('voice', instrumental);
  set('bpm', 200);
  set('fusion', 'Cinematic pop');
  const expected = el('output').value;
  el('save').onclick();
  assert.equal(downloads.length, 1);
  const file = downloads[0];
  assert.equal(file.name, 'alenta-suno-prompt.txt');
  assert.equal(file.attached, true);
  assert.equal(blobs.get(file.href).type, 'text/plain;charset=utf-8');
  assert.equal(await blobs.get(file.href).text(), expected);
  assert.equal(window.document.querySelectorAll('a[download]').length, 0);
  assert.deepEqual(revoked, []);
  assert.equal(timers.length, 1);
  assert.ok(timers[0].delay >= 10000);
  timers[0].fn();
  assert.deepEqual(revoked, [file.href]);
});

test('download failure leaves a manual-copy fallback', t => {
  const {el, downloads} = fixture(t, {failDownload: true});
  el('save').onclick();
  assert.equal(downloads.length, 0);
  assert.match(el('output-status').textContent, /Не удалось начать загрузку/);
  assert.equal(el('output').selectionEnd, el('output').value.length);
});

test('future overlong options cannot be silently truncated or exported', async t => {
  const {el, event, writes, downloads} = fixture(t);
  const option = el('inst').options[0];
  option.value = 'x'.repeat(1001);
  event('inst');
  assert.ok(el('output').value.length > 1000);
  assert.match(el('warning').textContent, /длиннее 1000/);
  assert.equal(el('copy').disabled, true);
  assert.equal(el('save').disabled, true);
  await el('copy').onclick();
  el('save').onclick();
  assert.deepEqual(writes, []);
  assert.deepEqual(downloads, []);
});
