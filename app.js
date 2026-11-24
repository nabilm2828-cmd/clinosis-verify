// CLINOSIS prescription page: the pharmacist sees whether the prescription is
// genuine (SPEC §20.16); the patient sees their drugs and sets medicine reminders
// on their own phone (SPEC §20.54). Nothing leaves the phone.
import { checkRx, drName, parseDays, parseDose, doseTimes, clock, firstDay, buildIcs, rxId } from './rx-core.js'

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const $ = (sel, root = document) => root.querySelector(sel)
const okIcon = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
const badIcon = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>'
const bellIcon = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>'
const dmy = (iso) => iso.split('-').reverse().join('/')
const dayWord = (n) => (n === 1 ? 'يوم' : n === 2 ? 'يومين' : n <= 10 ? `${n} أيام` : `${n} يوم`)
const timesWord = (n) => (n === 1 ? 'مرة' : n === 2 ? 'مرتين' : `${n} مرات`)

let rx = null      // the checked prescription
let plans = []     // per drug: {on, perDay, everyDays, intervalH, bedtime, days, prn}

// This phone remembers only that reminders were added for a prescription (an id, no drug names),
// so a second add can first ask to delete the old ones: a page can never delete calendar events.
const addedKey = () => `clinosis.added.${rxId(rx)}`
const wasAdded = () => { try { return localStorage.getItem(addedKey()) === '1' } catch { return false } }
const markAdded = () => { try { localStorage.setItem(addedKey(), '1') } catch { /* private mode */ } }

// iPhone: only Safari hands a calendar file to the Calendar; Brave, Chrome, Firefox and
// in-app browsers download it instead, so they are sent to Safari with the same link.
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
async function iosNotSafari() {
  if (!isIOS()) return false
  if (/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|DuckDuckGo|YaBrowser|Brave/.test(navigator.userAgent)) return true
  try { if (navigator.brave && (await navigator.brave.isBrave())) return true } catch { /* not Brave */ }
  return false
}
function safariLink() {
  const u = new URL(location.href)
  u.searchParams.set('remind', '1')
  return 'x-safari-' + u.href
}
const deleteSteps = 'افتح الميعاد في التقويم ← <span dir="ltr">Delete Event</span> ← <span dir="ltr">Delete All Future Events</span>، لكل ميعاد.'

async function run() {
  const code = location.hash.replace(/^#\/?(verify\/)?/, '')
  const out = $('#out')
  const r = code ? await checkRx(code) : { ok: false, reason: 'empty' }
  if (!r.ok) {
    rx = null
    out.innerHTML = r.reason === 'empty'
      ? '<section class="card state"><h2>امسح الكود</h2><p>امسح الـ QR اللي على الروشتة بكاميرا الموبايل.</p></section>'
      : r.reason === 'unsupported'
        ? `<section class="card state bad" role="alert"><span class="icon" aria-hidden="true">${badIcon}</span><h2>المتصفح ده مش بيقدر يتحقق</h2><p>افتح الرابط من Chrome أو Safari حديث.</p></section>`
        : `<section class="card state bad" role="alert"><span class="icon" aria-hidden="true">${badIcon}</span><h2>الروشتة دي مش سليمة</h2><p>متصرفش الروشتة، واتصل بالعيادة.</p></section>`
    return
  }
  rx = r
  plans = r.drugs.map((d) => {
    const p = parseDose(d.dose)
    const days = parseDays(d.duration)
    if (p && p.prn) return { on: false, prn: true, perDay: 1, everyDays: 1, intervalH: null, bedtime: false, days }
    return { on: true, prn: false, perDay: p ? p.perDay : null, everyDays: p ? p.everyDays : 1, intervalH: p ? p.intervalH : null, bedtime: p ? p.bedtime : false, days }
  })
  out.innerHTML = `
    <section class="card state ok compact" role="status"><span class="icon" aria-hidden="true">${okIcon}</span>
      <div><h2>روشتة سليمة</h2><p>اتكتبت فعلًا من العيادة ومحدش عدّل فيها.</p></div></section>
    <section class="card">
      <h2 class="rx-title">روشتتك من <bdi>${esc(r.clinic)}</bdi></h2>
      <p class="rx-meta"><bdi>${esc(drName(r.doctor))}</bdi> · <span class="num">${esc(dmy(r.date))}</span> · <span class="num">RX-${esc(r.rxNo)}</span></p>
      <ol class="drugs">${r.drugs.map((d, i) => `
        <li><span class="drug"><span class="num">${i + 1}.</span> ${esc(d.name)}</span>
          ${d.dose ? `<span class="dose">${esc(d.dose)}</span>` : ''}
          ${d.duration ? `<span class="dur">المدة: ${esc(d.duration)}</span>` : ''}</li>`).join('')}</ol>
      <div id="remind"><button type="button" class="btn primary" id="open-remind">${bellIcon}<span>اضبط مواعيد الدوا</span></button></div>
      <p class="note">للصيدلي: قارن الأدوية دي باللي مكتوب في الورقة. لو فيه اختلاف، الورقة اتعدّلت.</p>
    </section>`
  $('#open-remind').addEventListener('click', openRemind)
}

// ---------- reminders ----------
function finishedLongAgo() {
  const longest = Math.max(0, ...plans.map((p) => p.days || 0))
  if (!longest) return false
  const end = new Date(rx.date + 'T00:00:00')
  end.setDate(end.getDate() + longest + 2)
  return end < new Date()
}

function openRemind() {
  const box = $('#remind')
  box.innerHTML = `
    <div class="panel" id="panel">
      <h3>${bellIcon}<span>مواعيد الدوا</span></h3>
      ${wasAdded() ? `<p class="warn">ضفت مواعيد للروشتة دي قبل كده. امسح القديمة الأول عشان ما تتكررش: ${deleteSteps}</p>` : ''}
      ${finishedLongAgo() ? `<p class="warn">الروشتة دي من <span class="num">${esc(dmy(rx.date))}</span> ومدتها خلصت. اسأل دكتورك قبل ما تعيد الدوا.</p>` : ''}
      <label class="start"><span>أول جرعة الساعة كام؟</span><input type="time" id="start" value="08:00" step="900"></label>
      <div class="plans">${rx.drugs.map((d, i) => planRow(d, i)).join('')}</div>
      <p class="err" id="err" role="alert" hidden></p>
      <button type="button" class="btn primary" id="make">ضيف المواعيد لموبايلك</button>
      <button type="button" class="btn ghost" id="close">إلغاء</button>
    </div>`
  const panel = $('#panel')
  panel.addEventListener('click', onPanelClick)
  panel.addEventListener('input', onPanelInput)
  $('#make').addEventListener('click', make)
  $('#close').addEventListener('click', () => { run() })
  $('#start').focus()
  refreshTimes()
}

function planRow(d, i) {
  const p = plans[i]
  const chips = [0, 1, 2, 3, 4].map((n) => {
    const on = n === 0 ? !p.on : p.on && p.perDay === n
    return `<button type="button" class="chip ${on ? 'on' : ''}" data-i="${i}" data-n="${n}" aria-pressed="${on}">${n === 0 ? 'من غير تذكير' : timesWord(n)}</button>`
  }).join('')
  const every = p.everyDays === 2 ? 'يوم بعد يوم' : p.everyDays === 7 ? 'مرة في الأسبوع' : 'في اليوم'
  return `
    <div class="plan ${p.on ? '' : 'off'}" data-row="${i}">
      <div class="plan-name"><span class="drug">${esc(d.name)}</span>${d.dose ? `<span class="dose">${esc(d.dose)}</span>` : ''}</div>
      ${p.prn ? '<p class="hint">مكتوب "عند اللزوم"، فمفيش تذكير. لو عايز تذكير اختار عدد المرات.</p>' : ''}
      <div class="chips" role="group" aria-label="كام مرة ${every}">${chips}</div>
      <div class="plan-foot">
        <label class="days"><span>لمدة</span><input type="number" inputmode="numeric" min="1" max="365" data-days="${i}" value="${p.days ?? ''}" placeholder="—"><span>يوم</span></label>
        <span class="every">${p.on && p.perDay ? `${timesWord(p.perDay)} ${every}` : ''}</span>
      </div>
      <p class="times" data-times="${i}"></p>
    </div>`
}

function startMin() {
  const v = $('#start')?.value || '08:00'
  const [h, m] = v.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function refreshTimes() {
  const s = startMin()
  plans.forEach((p, i) => {
    const el = document.querySelector(`[data-times="${i}"]`)
    if (!el) return
    el.textContent = p.on && p.perDay ? doseTimes(p, s).map((t) => clock(t)).join(' · ') : ''
  })
}

function onPanelClick(e) {
  const b = e.target.closest('.chip')
  if (!b) return
  const i = Number(b.dataset.i), n = Number(b.dataset.n)
  const p = plans[i]
  if (n === 0) p.on = false
  else {
    // a different count than the doctor's "every N hours" spreads the doses over the day
    if (p.intervalH && n !== p.perDay) p.intervalH = null
    p.on = true; p.perDay = n; p.prn = false
  }
  const row = document.querySelector(`[data-row="${i}"]`)
  row.outerHTML = planRow(rx.drugs[i], i)
  $('#err').hidden = true
  refreshTimes()
}

function onPanelInput(e) {
  if (e.target.id === 'start') return refreshTimes()
  const i = e.target.dataset.days
  if (i === undefined) return
  const n = Number(e.target.value)
  plans[Number(i)].days = Number.isInteger(n) && n > 0 ? n : null
  e.target.classList.remove('bad')
  $('#err').hidden = true
}

function fail(msg) {
  const err = $('#err')
  err.textContent = msg
  err.hidden = false
  const panel = $('#panel')
  panel.classList.remove('shake')
  void panel.offsetWidth
  panel.classList.add('shake')
}

async function make() {
  const chosen = plans.map((p, i) => ({ p, i })).filter(({ p }) => p.on)
  if (!chosen.length) return fail('اختار عدد المرات لدوا واحد على الأقل.')
  const noCount = chosen.find(({ p }) => !p.perDay)
  if (noCount) return fail(`اختار كام مرة لـ ${rx.drugs[noCount.i].name}.`)
  const noDays = chosen.filter(({ p }) => !p.days || p.days > 365)
  if (noDays.length) {
    noDays.forEach(({ i }) => document.querySelector(`[data-days="${i}"]`)?.classList.add('bad'))
    return fail('اكتب المدة بالأيام (من 1 لـ 365).')
  }
  const s = startMin()
  const now = new Date()
  const start = firstDay(now, s)
  if (await iosNotSafari()) return toSafari()
  const items = chosen.map(({ p, i }) => ({ pos: i, name: rx.drugs[i].name, dose: rx.drugs[i].dose, times: doseTimes(p, s), days: p.days, everyDays: p.everyDays }))
  const ics = buildIcs({ rxNo: rx.rxNo, clinic: rx.clinic, doctor: rx.doctor, date: rx.date, items, start, now })
  const name = `clinosis-rx-${rx.rxNo}.ics`
  const delivered = await deliver(ics, name)
  if (delivered !== 'cancelled') markAdded()
  done(items, start, now, ics, name, delivered)
}

function toSafari() {
  $('#remind').innerHTML = `
    <div class="panel" role="alert">
      <h3>${bellIcon}<span>افتح الصفحة في Safari</span></h3>
      <p class="warn">المتصفح ده على الآيفون مش بيقدر يضيف للتقويم. Safari بس اللي بيقدر.</p>
      <a class="btn primary" href="${esc(safariLink())}">افتحها في Safari</a>
      <button type="button" class="btn ghost" id="copy">انسخ الرابط</button>
      <p class="hint" id="copied" hidden>اتنسخ. افتح Safari والزقه فوق.</p>
    </div>`
  $('#copy').addEventListener('click', async () => {
    const u = new URL(location.href); u.searchParams.set('remind', '1')
    try { await navigator.clipboard.writeText(u.href); $('#copied').hidden = false } catch { prompt('انسخ الرابط ده:', u.href) }
  })
}

/** Hands the file to the phone's calendar: share sheet on Android, Calendar sheet on iPhone, a download elsewhere. */
async function deliver(ics, name) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const ua = navigator.userAgent
  if (isIOS()) { location.href = URL.createObjectURL(blob); return 'ios' }
  try {
    const file = new File([blob], name, { type: 'text/calendar' })
    if (/Android/.test(ua) && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'مواعيد الدوا' })
      return 'share'
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled'
  }
  download(blob, name)
  return 'download'
}

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 4000)
}

function done(items, start, now, ics, name, how) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const when = start.getTime() === today.getTime() ? 'النهارده' : 'بكرة'
  const total = items.reduce((n, x) => n + x.times.length, 0)
  $('#remind').innerHTML = `
    <div class="panel done" role="status">
      <span class="icon" aria-hidden="true">${okIcon}</span>
      <h3>المواعيد جاهزة</h3>
      <p>${how === 'cancelled' ? 'لسه ما اتضافتش. دوس "ضيفها تاني" واختار التقويم.' : 'وافق على إضافتها في التقويم، والموبايل هيفكّرك في كل ميعاد.'}</p>
      <ul class="sched">${items.map((x) => `
        <li><span class="drug">${esc(x.name)}</span>
          <span class="when">${x.times.map((t) => `<bdi>${clock(t)}</bdi>`).join(' · ')}</span>
          <span class="dose">${x.everyDays === 2 ? 'يوم بعد يوم' : x.everyDays === 7 ? 'مرة في الأسبوع' : 'كل يوم'} · لمدة ${dayWord(x.days)} · تبدأ ${when}</span></li>`).join('')}</ul>
      <p class="hint">${total === 1 ? 'تذكير واحد' : total <= 10 ? `${total} تذكيرات` : `${total} تذكير`}. لو التقويم ما فتحش لوحده، افتح الملف <span class="num">${esc(name)}</span> من التنزيلات.</p>
      ${isIOS() ? `<p class="hint">لو نزل ملف بدل ما يفتح التقويم: <a href="${esc(safariLink())}">افتح الصفحة في Safari</a>.</p>` : ''}
      <button type="button" class="btn primary" id="again">ضيفها تاني</button>
      <button type="button" class="btn ghost" id="edit">تعديل المواعيد</button>
    </div>`
  $('#again').addEventListener('click', () => deliver(ics, name))
  $('#edit').addEventListener('click', openRemind)
}

// Opened from "افتحها في Safari": go straight to the reminders.
const wantRemind = new URLSearchParams(location.search).get('remind') === '1'
if (wantRemind) history.replaceState(null, '', location.pathname + location.hash)
run().then(() => { if (wantRemind && rx) openRemind() })
window.addEventListener('hashchange', run)
