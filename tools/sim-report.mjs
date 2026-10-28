// Сводка результатов tools/sim.mjs: распределения, а не только средние.
//   node tools/sim-report.mjs sim-results/base.json [sim-results/after.json]
import fs from 'node:fs';

const files = process.argv.slice(2);
const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i); return +(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)).toFixed(1); };
const dist5 = (xs) => (xs.length ? `мед ${q(xs, 0.5)} [${q(xs, 0.25)}–${q(xs, 0.75)}], ${q(xs, 0)}…${q(xs, 1)} (n=${xs.length})` : '—');
const mmss = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function report(file) {
  const { matches, cap } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const done = matches.filter((m) => !m.capped);
  const heroes = matches.flatMap((m) => m.heroes.map((h) => ({ ...h, dur: m.duration })));
  const lines = [];
  const L = (s) => lines.push(s);
  L(`# ${file}: ${matches.length} матчей, предел ${cap} с игры`);
  L(`закончено ${done.length}, НЕ закончено (предел) ${matches.length - done.length}`);
  L(`длительность законченных, мин:с — мед ${mmss(q(done.map((m) => m.duration), 0.5))}, [${mmss(q(done.map((m) => m.duration), 0.25))}–${mmss(q(done.map((m) => m.duration), 0.75))}], ${mmss(q(done.map((m) => m.duration), 0))}…${mmss(q(done.map((m) => m.duration), 1))}`);
  for (const d of ['easy', 'normal', 'hard']) {
    const ms = done.filter((m) => m.difficulty === d);
    L(`  ${d}: побед синих ${ms.filter((m) => m.winner === 0).length}, красных ${ms.filter((m) => m.winner === 1).length}, не закончено ${matches.filter((m) => m.difficulty === d && m.capped).length}`);
  }
  const first = (m, kind, order) => m.structures.filter((s) => s.kind === kind && (order == null || s.order === order)).map((s) => s.t).sort((a, b) => a - b)[0];
  L(`первая башня, с: ${dist5(matches.map((m) => first(m, 'tower')).filter((x) => x != null))}`);
  L(`первый ингибитор, с: ${dist5(matches.map((m) => first(m, 'inhib')).filter((x) => x != null))}`);
  const openToEnd = done.map((m) => { const loser = 1 - m.winner; return m.nexusOpen[loser] != null ? m.duration - m.nexusOpen[loser] : null; }).filter((x) => x != null);
  L(`нексус открыт → конец матча, с: ${dist5(openToEnd)}`);
  const reopened = matches.map((m) => m.nexusOpen.filter((t) => t != null).length);
  L(`матчей, где открывался нексус проигравшего и игра продолжалась > 120 с: ${openToEnd.filter((x) => x > 120).length}`);
  L(`драконов за матч: ${dist5(matches.map((m) => m.dragons.length))}; первый дракон, с: ${dist5(matches.map((m) => m.dragons[0]?.t).filter((x) => x != null))}`);
  const fw = matches.flatMap((m) => m.fightWins);
  L(`выигранных драк ${fw.length}, из них за 45 с били здания: ${fw.filter((f) => f.pushed).length} (${fw.length ? Math.round((fw.filter((f) => f.pushed).length / fw.length) * 100) : 0}%)`);
  L(`убийств героев за матч: ${dist5(matches.map((m) => m.kills.length))}; от башен: ${sum(matches.map((m) => m.kills.filter((k) => k.tower).length))}`);
  const per = (key) => dist5(heroes.map((h) => h[key]));
  const perMin = (key) => dist5(heroes.map((h) => +(h[key] / (h.dur / 60)).toFixed(2)));
  L('на героя за матч:');
  L(`  застревания ≥2 с: ${per('stuckLong')}; секунд застревания: ${per('stuck')}`);
  L(`  простой ≥3 с (не идёт, не бьёт, вне базы): ${per('idleLong')}; секунд: ${per('idle')}`);
  L(`  развороты движения в минуту: ${per('reversalsPerMin')}; смены решения в минуту: ${per('modeSwitchesPerMin')}`);
  L(`  доля времени в отступлении/лечении, %: ${dist5(heroes.map((h) => +(100 * h.retreat / h.dur).toFixed(1)))}`);
  L(`  смертей: ${per('deaths')}; от башни: ${per('towerDeaths')}; попаданий башни: ${per('towerHits')}`);
  L(`  походов на базу: ${per('baseTrips')}; без покупки и лечения: ${per('pointlessTrips')}; возвратов «Домой»: ${per('recalls')}`);
  L(`  предметов к концу: ${per('items')}; уровень: ${per('level')}; золото на руках: ${per('gold')}`);
  for (const role of ['lane', 'jungle']) {
    const hr = heroes.filter((h) => h.role === role);
    L(`  роль ${role}: смертей ${dist5(hr.map((h) => h.deaths))}; простой ${dist5(hr.map((h) => h.idle))}; застревание ${dist5(hr.map((h) => h.stuck))}`);
  }
  return lines.join('\n');
}

for (const f of files) console.log(report(f) + '\n');
