// CLINOSIS prescription QR — shared logic for the public page (SPEC §12.3, §20.16,
// §20.54, §26). Pure functions, no page access: the page (app.js) and the tests
// (tests/e2e/rx_patient.mjs, run with node) both import this file.
//
// QR layout (base64url): 1 version · 32 clinic key · 64 owner certificate · 64 signature ·
// text "licenseId␟clinic␟rxNo␟date␟doctor␟drug␞drug…", each drug "name␝dose␝duration"
// (prescriptions printed before M2.8b have no duration). Everything happens on the
// phone: nothing is sent anywhere and nothing is stored.

export const OWNER_PUBLIC_KEY = 'qmnoEHQx7Lzvadn5oBNUGyWkq+rhi24Hf/4l/NHPpG8='

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const b64url = (s) => b64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
const toB64 = (b) => btoa(String.fromCharCode(...b))

async function edVerify(pub, msg, sig) {
  const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify'])
  return crypto.subtle.verify({ name: 'Ed25519' }, key, sig, msg)
}

/**
 * Checks a printed code. Version 1 = prescription:
 *   {ok:true, type:'rx', clinic, doctor, date, rxNo, drugs:[{name,dose,duration}]}
 * Version 2 = medical report / certificate (M2.8c), text "lic␟clinic␟no␟date␟doctor␟kind␟patient␟detail":
 *   {ok:true, type:'report', clinic, doctor, date, no, kind, patient, from, days, result, purpose}
 * Version 3 = glasses / contact-lens prescription (owner, 28 Nov 2026), text
 *   "lic␟clinic␟no␟date␟doctor␟kind␟patient␟OD␞OS␟extra", each eye "sph␝cyl␝axis␝add␝a␝b"
 *   (glasses: prism, base; contact: BC, DIA), extra glasses "pd␝pdNear␝use", contact "type␝replacement":
 *   {ok:true, type:'glasses', kind, clinic, doctor, date, no, patient, od, os, pd, pdNear, use, lensType, replacement}
 * or {ok:false, reason}.
 */
export async function checkRx(code) {
  let raw
  try { raw = b64url(String(code).trim()) } catch { return { ok: false, reason: 'format' } }
  if (raw.length < 170 || (raw[0] !== 1 && raw[0] !== 2 && raw[0] !== 3)) return { ok: false, reason: 'format' }
  const report = raw[0] === 2, glasses = raw[0] === 3
  if (!(globalThis.crypto && crypto.subtle)) return { ok: false, reason: 'unsupported' }
  const pub = raw.slice(1, 33), cert = raw.slice(33, 97), sig = raw.slice(97, 161), textBytes = raw.slice(161)
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(textBytes) } catch { return { ok: false, reason: 'format' } }
  const f = text.split('\x1f')
  if (f.length !== (glasses ? 9 : report ? 8 : 6)) return { ok: false, reason: 'format' }
  const [lic, clinic, rxNo, date, doctor, drugs] = f
  const enc = new TextEncoder()
  try {
    const certOk = await edVerify(b64(OWNER_PUBLIC_KEY), enc.encode(`CLINOSIS-RX1|${lic}|${clinic}|${toB64(pub)}`), cert)
    const msg = new Uint8Array([...enc.encode(glasses ? 'CLINOSIS-EYESIG1|' : report ? 'CLINOSIS-REPSIG1|' : 'CLINOSIS-RXSIG1|'), ...textBytes])
    if (!certOk || !(await edVerify(pub, msg, sig))) return { ok: false, reason: 'signature' }
  } catch { return { ok: false, reason: 'unsupported' } }
  if (glasses) {
    const [, , no, day, dr, kind, patient, eyes, extra] = f
    const [odS = '', osS = ''] = eyes.split('\x1e')
    const eye = (s) => { const [sph = '', cyl = '', axis = '', add = '', a = '', b = ''] = s.split('\x1d'); return { sph, cyl, axis, add, a, b } }
    const [x1 = '', x2 = '', x3 = ''] = extra.split('\x1d')
    return {
      ok: true, type: 'glasses', kind, clinic, doctor: dr, date: day, no, patient, od: eye(odS), os: eye(osS),
      pd: kind === 'glasses' ? x1 : '', pdNear: kind === 'glasses' ? x2 : '', use: kind === 'glasses' ? x3 : '',
      lensType: kind === 'contact' ? x1 : '', replacement: kind === 'contact' ? x2 : '',
    }
  }
  if (report) {
    const [, , no, day, dr, kind, patient, detail] = f
    const [a = '', b = ''] = detail.split('\x1d')
    return {
      ok: true, type: 'report', clinic, doctor: dr, date: day, no, kind, patient,
      from: kind === 'sick_leave' ? a : '', days: kind === 'sick_leave' ? b : '',
      result: kind === 'fitness' ? a : '', purpose: kind === 'fitness' ? b : '',
    }
  }
  return {
    ok: true, type: 'rx', clinic, doctor, date, rxNo,
    drugs: drugs.split('\x1e').filter(Boolean).map((d) => { const [name, dose = '', duration = ''] = d.split('\x1d'); return { name, dose, duration } }),
  }
}

/** Lens power as an optician reads it: "+1.25" / "−0.50" / "Plano" (empty → "—"). */
export function lensNum(v, plano = false) {
  if (v === '' || v == null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return plano ? 'Plano' : '0.00'
  return (n > 0 ? '+' : '−') + Math.abs(n).toFixed(2)
}

/** The same lens in the other cylinder form: sphere + cylinder, the cylinder's sign flipped, axis turned 90°. */
export function transpose(e) {
  const cyl = Number(e.cyl)
  if (!e.cyl || !cyl) return null
  const ax = Number(e.axis || 0)
  return { ...e, sph: String(Math.round((Number(e.sph || 0) + cyl) * 100) / 100), cyl: String(-cyl), axis: String(ax <= 90 ? ax + 90 : ax - 90) }
}

/** "د. Name" unless the name already starts with a title. */
export const drName = (n) => (/^\s*(د\s*\.|دكتور|Dr\.?\s)/i.test(n) ? n : 'د. ' + n)

const latin = (s) => String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))

/** "5 أيام" / "أسبوعين" / "شهر" / "10 days" → days; null when not clear (e.g. "مستمر"). Same rule as web/src/rxCode.ts. */
export function parseDays(s) {
  const t = latin(s).trim().toLowerCase()
  if (!t) return null
  const n = Number((t.match(/\d+/) ?? ['1'])[0])
  if (/أسبوعين|اسبوعين/.test(t)) return 14
  if (/شهرين/.test(t)) return 60
  if (/يومين/.test(t)) return 2
  if (/أسبوع|اسبوع|week/.test(t)) return n * 7
  if (/شهر|month/.test(t)) return n * 30
  if (/سنة|سنه|year/.test(t)) return n * 365
  if (/يوم|أيام|ايام|day/.test(t)) return n
  return /^\d+$/.test(t) ? n : null
}

/**
 * Reads how often a dose is taken from what the doctor wrote.
 * {prn:true} = only when needed (no reminder); {perDay, everyDays, intervalH, bedtime};
 * null = not clear: the patient chooses. The patient always sees and can change the result.
 */
export function parseDose(s) {
  const t = latin(s).toLowerCase().replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (/عند اللزوم|وقت اللزوم|عند الحاجة|عند الحاجه|لو احتاج|\bprn\b|as needed|when needed|if needed/.test(t)) return { prn: true }
  const bedtime = /قبل النوم|at bedtime|before sleep|\bhs\b/.test(t)
  let everyDays = 1
  if (/يوم بعد يوم|يوم ويوم لا|يوم آه ويوم لا|كل يومين|every other day|alternate days/.test(t)) everyDays = 2
  else if (/(ف|في) ?(ال)?(أ|ا)سبوع|أسبوعي|اسبوعي|weekly|once a week|per week/.test(t)) everyDays = 7
  const iv = t.match(/كل ?(\d+) ?(ساعات|ساعة|ساعه|س\b)|every ?(\d+) ?(h|hrs?|hours?)\b|\bq ?(\d+) ?h\b/)
  if (iv) {
    const h = Number(iv[1] ?? iv[3] ?? iv[5])
    if (h >= 2 && h <= 24) return { perDay: Math.max(1, Math.round(24 / h)), everyDays: 1, intervalH: h, bedtime: false }
  }
  let perDay = null
  let m
  if (/مرتين|twice|\bbid\b|\bb\.i\.d\b/.test(t)) perDay = 2
  else if (/(ثلاث|تلات|تلت) مرات|thrice|three times|\btid\b|\bt\.i\.d\b/.test(t)) perDay = 3
  else if (/(أربع|اربع|اربعة) مرات|four times|\bqid\b|\bq\.i\.d\b/.test(t)) perDay = 4
  else if ((m = t.match(/(\d+) ?(مرات|مرة|مره|times?)/))) perDay = Number(m[1])
  else if ((m = t.match(/(\d+) ?[x×*] ?(\d+)/))) perDay = Number(m[2])
  else if (/مرة|مره|once|يومي|يوميا|يومياً|يوميًا|daily|\bod\b|\bqd\b/.test(t) || bedtime || everyDays > 1) perDay = 1
  if (!perDay || perDay < 1 || perDay > 6) return null
  return { perDay, everyDays, intervalH: null, bedtime: bedtime && perDay === 1 }
}

/** Minutes from the start day's midnight for each dose (can pass midnight). */
export function doseTimes(plan, startMin) {
  if (!plan || plan.prn || !plan.perDay) return []
  if (plan.bedtime && plan.perDay === 1) return [22 * 60]
  const n = plan.perDay
  if (plan.intervalH) return Array.from({ length: n }, (_, k) => startMin + k * plan.intervalH * 60)
  if (n === 1) return [startMin]
  // spread over the waking day: never more than 24/n hours apart, all within ~15 hours
  const step = Math.round(Math.min(24 / n, 15 / (n - 1)) * 2) * 30
  return Array.from({ length: n }, (_, k) => startMin + k * step)
}

/** Clock text for a minute count: "8:00 ص" / "8:00 AM". */
export function clock(min, lang = 'ar') {
  const m = ((min % 1440) + 1440) % 1440
  const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0')
  const h12 = h % 12 === 0 ? 12 : h % 12
  return lang === 'ar' ? `${h12}:${mm} ${h < 12 ? 'ص' : 'م'}` : `${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}`
}

/** The first dose day: today, unless the chosen time already passed (15 minutes' grace). */
export function firstDay(now, startMin) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (startMin < now.getHours() * 60 + now.getMinutes() - 15) d.setDate(d.getDate() + 1)
  return d
}

const pad = (n) => String(n).padStart(2, '0')
const icsLocal = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
const icsUTC = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Lines longer than 75 bytes are folded (RFC 5545), never inside a character. */
function fold(line) {
  const enc = new TextEncoder()
  const out = []
  let cur = '', size = 0, limit = 75
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (size + n > limit) { out.push(cur); cur = ''; size = 0; limit = 74 }
    cur += ch; size += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

/** A short id for one prescription (same on every phone, different between clinics): FNV-1a of what the QR names. */
export function rxId({ clinic, rxNo, date, doctor }) {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(`${clinic}|${rxNo}|${date}|${doctor}`)) h = Math.imul(h ^ b, 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

/**
 * A calendar file with one repeating event per dose time, each with an alarm at
 * that time. Times are "floating" (the phone's own clock), so travel or summer
 * time never moves a dose.
 * Each reminder keeps the same UID every time it is made (prescription · drug · dose
 * number) with a newer SEQUENCE, so adding again can update instead of duplicate
 * (whether it does is up to the phone's calendar — a page can never delete events).
 * items: [{pos (drug position on the prescription), name, dose, times:[minutes], days, everyDays, start? (own first day)}]
 */
export function buildIcs({ rxNo, clinic, doctor, date = '', items, start, now = new Date() }) {
  const id = rxId({ clinic, rxNo, date, doctor })
  const seq = Math.floor(now.getTime() / 60000) - 29000000
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CLINOSIS//Medicine reminders//AR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  const stamp = icsUTC(now)
  items.forEach((x, i) => {
    const every = x.everyDays || 1
    const count = Math.max(1, Math.ceil(x.days / every))
    x.times.forEach((t, k) => {
      const s0 = x.start || start
      const at = new Date(s0.getFullYear(), s0.getMonth(), s0.getDate(), 0, t)
      const title = x.dose ? `${x.name} · ${x.dose}` : x.name
      L.push('BEGIN:VEVENT',
        `UID:clinosis-${id}-d${(x.pos ?? i) + 1}-n${k + 1}@clinosis`,
        `SEQUENCE:${Math.max(0, seq)}`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsLocal(at)}`,
        `DTEND:${icsLocal(new Date(at.getTime() + 15 * 60000))}`,
        `RRULE:FREQ=DAILY;INTERVAL=${every};COUNT=${count}`,
        `SUMMARY:${icsText(title)}`,
        `DESCRIPTION:${icsText(`RX-${rxNo} · ${clinic} · ${drName(doctor)}`)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(title)}`, 'TRIGGER:PT0M', 'END:VALARM',
        'END:VEVENT')
    })
  })
  L.push('END:VCALENDAR')
  return L.map(fold).join('\r\n') + '\r\n'
}

/**
 * Android: one link per dose time that opens the phone's own calendar app on a new,
 * already-filled repeating event (Android's standard "insert event" request; Chrome and
 * Samsung Internet open intent: links). The patient taps Save. Nothing goes online.
 * Returns [{pos, k, name, time, url}].
 */
export function androidLinks({ rxNo, clinic, doctor, items }) {
  const out = []
  const enc = (v) => encodeURIComponent(v)
  items.forEach((x, i) => {
    const every = x.everyDays || 1
    const count = Math.max(1, Math.ceil(x.days / every))
    const s0 = x.start
    x.times.forEach((t, k) => {
      const at = new Date(s0.getFullYear(), s0.getMonth(), s0.getDate(), 0, t)
      const title = x.dose ? `${x.name} · ${x.dose}` : x.name
      const url = 'intent:#Intent;action=android.intent.action.INSERT;type=vnd.android.cursor.item/event;'
        + `S.title=${enc(title)};S.description=${enc(`RX-${rxNo} · ${clinic} · ${drName(doctor)}`)};`
        + `l.beginTime=${at.getTime()};l.endTime=${at.getTime() + 15 * 60000};`
        + `S.rrule=${enc(`FREQ=DAILY;INTERVAL=${every};COUNT=${count}`)};i.availability=1;end`
      out.push({ pos: x.pos ?? i, k, name: x.name, time: t, url })
    })
  })
  return out
}
