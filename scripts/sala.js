#!/usr/bin/env node
'use strict';
// Gera o perfil em pixel art: a sala (assets/sala.svg), o cabeçalho, o about, os números,
// os cards dos projetos e o painel de atividade. Roda no GitHub Actions (veja .github/workflows/perfil.yml).
//
// Variáveis: GITHUB_TOKEN (o Actions fornece), GH_USER (padrão: dono do repositório),
// DATA_FILE (JSON com os dados já prontos, só pra testar sem rede), README (padrão README.md).
// Sem dependências: só Node 20+. As partes fixas da sala ficam em scripts/cena.js.

const fs = require('node:fs');
const path = require('node:path');
const cena = require('./cena.js');

const USER = process.env.GH_USER || (process.env.GITHUB_REPOSITORY || '').split('/')[0];
const TOKEN = process.env.GITHUB_TOKEN || '';
const README = process.env.README || 'README.md';
const OUT = process.env.OUT_DIR || 'assets';
const TZ = 'America/Sao_Paulo';
const CIDADE = { nome: 'MGA', lat: -23.4205, lon: -51.9333 }; // Maringá

// ---------------------------------------------------------------- dados

const QUERY = `query($login: String!) {
  user(login: $login) {
    login name
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC, first: 100, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes {
        name description url stargazerCount isFork isArchived pushedAt
        primaryLanguage { name color }
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } }
        defaultBranchRef { target { ... on Commit { history(first: 5) { nodes { messageHeadline committedDate } } } } }
      }
    }
    contributionsCollection {
      totalCommitContributions totalPullRequestContributions
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

async function fetchGitHub() {
  if (!USER) throw new Error('Não sei qual usuário consultar (defina GH_USER).');
  if (!TOKEN) throw new Error('GITHUB_TOKEN é obrigatório pra API GraphQL.');
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'perfil-sala' },
    body: JSON.stringify({ query: QUERY, variables: { login: USER } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors || json).slice(0, 300)}`);
  const u = json.data.user;
  const cc = u.contributionsCollection;
  return {
    login: u.login,
    name: u.name || u.login,
    followers: u.followers.totalCount,
    repos: u.repositories.nodes.map((r) => ({
      name: r.name,
      description: r.description || '',
      url: r.url,
      stars: r.stargazerCount,
      fork: r.isFork,
      archived: r.isArchived,
      pushedAt: r.pushedAt,
      language: r.primaryLanguage,
      languages: r.languages.edges.map((e) => ({ name: e.node.name, color: e.node.color, size: e.size })),
      commits: (r.defaultBranchRef?.target?.history?.nodes || []).map((c) => ({ message: c.messageHeadline, date: c.committedDate })),
    })),
    stats: { commits: cc.totalCommitContributions, prs: cc.totalPullRequestContributions, total: cc.contributionCalendar.totalContributions },
    days: cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount }))),
  };
}

async function fetchClima() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${CIDADE.lat}&longitude=${CIDADE.lon}&current=temperature_2m,weather_code,is_day&timezone=${encodeURIComponent(TZ)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const c = (await res.json()).current;
    return { temp: Math.round(c.temperature_2m), code: c.weather_code, isDay: c.is_day === 1 };
  } catch {
    return null; // sem clima a sala ainda sai, com o céu pela hora do dia
  }
}

// ---------------------------------------------------------------- utilidades

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

function agoraSP(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { dia: +p.day, mes: +p.month, ano: +p.year, hora: +p.hour % 24, min: +p.minute, data: `${p.year}-${p.month}-${p.day}` };
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const dataCurta = (iso) => {
  const t = agoraSP(iso);
  return `${t.dia} ${MESES[t.mes - 1]}`;
};

// sequências de dias com contribuição
function sequencias(days, hoje) {
  const lista = days.filter((d) => d.date <= hoje);
  let melhor = 0;
  let run = 0;
  for (const d of lista) {
    run = d.count > 0 ? run + 1 : 0;
    melhor = Math.max(melhor, run);
  }
  // a atual não quebra só porque hoje ainda não teve commit
  let i = lista.length - 1;
  if (i >= 0 && lista[i].date === hoje && lista[i].count === 0) i--;
  let atual = 0;
  while (i >= 0 && lista[i].count > 0) atual++, i--;
  return { atual, melhor };
}

// ---------------------------------------------------------------- fonte pixel 3x5

const G = {
  'A': '.#.#.#####.##.#',
  'B': '##.#.###.#.###.',
  'C': '.###..#..#...##',
  'D': '##.#.##.##.###.',
  'E': '####..##.#..###',
  'F': '####..##.#..#..',
  'G': '.###..#.##.#.##',
  'H': '#.##.#####.##.#',
  'I': '###.#..#..#.###',
  'J': '..#..#..##.#.#.',
  'K': '#.##.###.#.##.#',
  'L': '#..#..#..#..###',
  'M': '#.########.##.#',
  'N': '##.#.##.##.##.#',
  'O': '.#.#.##.##.#.#.',
  'P': '##.#.###.#..#..',
  'Q': '.#.#.##.###..##',
  'R': '##.#.###.#.##.#',
  'S': '.###...#...###.',
  'T': '###.#..#..#..#.',
  'U': '#.##.##.##.####',
  'V': '#.##.##.##.#.#.',
  'W': '#.##.########.#',
  'X': '#.##.#.#.#.##.#',
  'Y': '#.##.#.#..#..#.',
  'Z': '###..#.#.#..###',
  '0': '####.##.##.####',
  '1': '.#.##..#..#.###',
  '2': '##...#.#.#..###',
  '3': '##...#.#...###.',
  '4': '#.##.####..#..#',
  '5': '####..##...###.',
  '6': '.###..####.####',
  '7': '###..#.#..#..#.',
  '8': '####.#####.####',
  '9': '####.####..###.',
  ' ': '...............',
  ':': '....#.....#....',
  '.': '.............#.',
  '-': '......###......',
  '°': '.#.#.#.#.......',
  '/': '..#..#.#.#..#..',
  '+': '....#.###.#....',
  '#': '#.#####.#####.#',
  '%': '#.#..#.#.#..#.#',
  '>': '#...#...#.#.#..',
  '_': '............###',
  ',': '..........#.#..',
  '!': '.#..#..#.....#.',
  '?': '##...#.#.....#.',
  "'": '.#..#..........',
  '(': '.#.#..#..#...#.',
  ')': '.#...#..#..#.#.',
  '~': '....####.......',
  '·': '.......#.......',
};

const MARCAS = { '́': [[1, -2], [2, -2]], '̀': [[0, -2], [1, -2]], '̂': [[0, -2], [1, -2], [2, -2]], '̃': [[0, -2], [1, -2], [2, -2]], '̧': [[1, 5]] };

// devolve o "d" de um <path> com o texto em pixels; s = tamanho do pixel
function pix(texto, x, y, s = 1) {
  let d = '';
  let cx = x;
  const add = (px, py) => (d += `M${cx + px * s} ${y + py * s}h${s}v${s}h-${s}z`);
  for (const ch of String(texto).toUpperCase().normalize('NFD')) {
    if (MARCAS[ch]) {
      cx -= 4 * s;
      for (const [px, py] of MARCAS[ch]) add(px, py);
      cx += 4 * s;
      continue;
    }
    const g = G[ch] || G['?'];
    for (let i = 0; i < 15; i++) if (g[i] === '#') add(i % 3, Math.floor(i / 3));
    cx += 4 * s;
  }
  return d;
}
const pixW = (texto, s = 1) => [...String(texto).normalize('NFD')].filter((c) => !MARCAS[c]).length * 4 * s - s;

// ---------------------------------------------------------------- tema e conteúdo

const COR = { fundo: '#0b0905', painel: '#110d08', barra: '#17120b', borda: '#3a2c17', texto: '#e9d9bd', apagado: '#b89a6a', destaque: '#ffb347' };
const MONO = 'ui-monospace,SFMono-Regular,Consolas,Menlo,monospace';

const PERFIL = {
  nome: 'Victor Hugo',
  stack: ['JavaScript', 'Python', 'HTML5', 'CSS'],
  aprendendo: ['Java', 'Spring Boot'],
  sobre:
    "Welcome to my profile! I'm Victor Hugo Antonio, a Systems Analysis and Development graduate working as an Infrastructure Analyst, focused on AIOps and observability. I love programming and keep growing as a developer, currently learning Java and Spring Boot.",
  prateleira: ['JS', 'SB', 'JV', 'PY', 'HT', 'CS'], // um cartucho por item, na ordem da estante
  ocultar: ['topwatch'], // repositórios que não aparecem nos cards
};

// ---------------------------------------------------------------- a sala

function tipoClima(code) {
  if (code == null) return 'limpo';
  if (code <= 1) return 'limpo';
  if (code <= 48) return 'nublado';
  if (code >= 95) return 'tempestade';
  return 'chuva';
}
const NOME_CLIMA = { limpo: 'CÉU LIMPO', nublado: 'NUBLADO', chuva: 'CHUVA', tempestade: 'TEMPESTADE' };

function janela(dia, tipo, A) {
  const r = (x, y, w, h, f, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"${extra}/>`;
  const ceu = dia ? ['#4a3820', '#5c4628', '#6e5530'] : ['#0c0906', '#130e08', '#1d150b'];
  const o = [r(46, 8, 66, 14, ceu[0]), r(46, 22, 66, 14, ceu[1]), r(46, 36, 66, 14, ceu[2])];
  if (!dia && tipo !== 'chuva' && tipo !== 'tempestade')
    [[52, 12], [64, 17], [98, 11], [107, 19], [58, 24], [92, 21]].forEach(([x, y], i) =>
      o.push(r(x, y, 1, 1, '#c9a46a', ` class="estrela" style="animation-delay:${(i * 0.5).toFixed(1)}s"`)));
  if (tipo === 'limpo') {
    if (dia) o.push(r(96, 12, 6, 6, '#ffd27a'), r(97, 11, 4, 8, '#ffd27a'), r(95, 13, 8, 4, '#ffd27a'));
    else o.push(r(96, 11, 5, 5, '#e9d9bd'), r(98, 11, 3, 3, ceu[0]));
  }
  // catedral
  [[78, 12, 2, 4], [77, 16, 4, 5], [76, 21, 6, 5], [75, 26, 8, 5], [74, 31, 10, 5], [73, 36, 12, 5], [72, 41, 14, 9]].forEach(([x, y, w, h]) =>
    o.push(r(x, y, w, h, '#3a2c15')));
  o.push(r(78.5, 9, 1, 3, '#5a4420'), r(77.5, 10, 3, 1, '#5a4420'), r(78.5, 8, 1, 1, '#ffe2b0', ' class="farol"'));
  // prédios, com janelas acesas só à noite
  [[48, 36, 8, 14], [57, 32, 7, 18], [65, 39, 6, 11], [88, 34, 8, 16], [97, 30, 6, 20], [104, 37, 8, 13]].forEach(([x, y, w, h]) => o.push(r(x, y, w, h, '#2a2010')));
  const acesa = dia ? '#4a3a1f' : A;
  [[50, 39], [53, 43], [59, 35], [61, 41], [90, 38], [99, 33], [100, 42], [107, 40]].forEach(([x, y]) => o.push(r(x, y, 1, 1, acesa, dia ? '' : ' opacity=".7"')));
  if (tipo !== 'limpo') {
    const nuvem = (x, y, cls) => `<g class="${cls}">${r(x, y + 2, 12, 3, dia ? '#8a7048' : '#241b0f')}${r(x + 2, y, 6, 3, dia ? '#8a7048' : '#241b0f')}${r(x + 6, y + 1, 4, 2, dia ? '#8a7048' : '#241b0f')}</g>`;
    o.push(nuvem(50, 11, 'nuvem1'), nuvem(84, 15, 'nuvem2'));
  }
  if (tipo === 'chuva' || tipo === 'tempestade') {
    const gotas = [[49, 10], [55, 22], [61, 14], [67, 30], [71, 18], [86, 12], [91, 26], [95, 16], [101, 24], [106, 13], [110, 29], [52, 30], [58, 44], [64, 38], [84, 40], [93, 44], [103, 36], [108, 46]]
      .map(([x, y]) => r(x, y, 1, 3, '#b88a45')).join('');
    o.push(`<g class="chuva" opacity=".55">${gotas}</g>`);
  }
  if (tipo === 'tempestade') o.push(r(46, 8, 66, 42, '#ffe2b0', ' class="raio"'));
  return `<g clip-path="url(#janela)">${o.join('')}</g>`;
}

function sala(dados) {
  const A = COR.destaque;
  const t = agoraSP(dados.now);
  const clima = dados.weather;
  const dia = clima ? clima.isDay : t.hora >= 6 && t.hora < 18;
  const tipo = tipoClima(clima?.code);

  const rotulos = PERFIL.prateleira
    .slice(0, 6)
    .map((txt, i) => `<path fill="#b88a45" d="${pix(txt, 132.5 + i * 6 - pixW(txt, 0.52) / 2, 15.6, 0.52)}"/>`)
    .join('');

  // ponteiros do relógio (centro 186,10)
  const ang = (((t.hora % 12) + t.min / 60) / 12) * 2 * Math.PI;
  const angM = (t.min / 60) * 2 * Math.PI;
  let ponteiros = '';
  for (let k = 1; k <= 2; k++) ponteiros += `<rect x="${Math.round(186 + Math.sin(ang) * k)}" y="${Math.round(10 - Math.cos(ang) * k)}" width="1" height="1" fill="#120e08"/>`;
  for (let k = 1; k <= 3; k++) ponteiros += `<rect x="${Math.round(186 + Math.sin(angM) * k)}" y="${Math.round(10 - Math.cos(angM) * k)}" width="1" height="1" fill="#3a2410"/>`;
  ponteiros += '<rect x="186" y="10" width="1" height="1" fill="#120e08"/>';

  const p2 = (n) => String(n).padStart(2, '0');
  const esq = clima ? `MARINGÁ · ${clima.temp}°C · ${NOME_CLIMA[tipo]}` : `MARINGÁ · ${p2(t.hora)}H${p2(t.min)}`;
  const dir = `ATUALIZADO ${p2(t.dia)}/${p2(t.mes)} ${p2(t.hora)}H${p2(t.min)}`;
  const rodape = `<path fill="#b88a45" d="${pix(esq, 4, 79.5, 0.6)}"/><path fill="#b88a45" d="${pix(dir, 216 - pixW(dir, 0.6), 79.5, 0.6)}"/>`;

  const corpo = (cena.ANTES_DA_JANELA + janela(dia, tipo, A) + cena.DEPOIS_DA_JANELA)
    .replace('@@ROTULOS@@', rotulos)
    .replace('@@PONTEIROS@@', ponteiros)
    .replace('@@RODAPE@@', rodape)
    .replaceAll('{{accent}}', A);

  const desc = `Sala em pixel art: estante de livros, janela com a Catedral de Maringá (${clima ? `${clima.temp}°C, ${NOME_CLIMA[tipo].toLowerCase()}` : 'à noite'}), prateleira com um cartucho por tecnologia, mesa com computador e cadeira.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="340" viewBox="0 0 220 85" role="img" aria-label="${esc(desc)}">
<title>${esc(desc)}</title>
<defs><clipPath id="janela"><rect x="46" y="8" width="66" height="42"/></clipPath></defs>
<style>
.farol{animation:farol 2.4s steps(1) infinite}@keyframes farol{0%,60%{opacity:1}61%,100%{opacity:.1}}
.chuva{animation:chuva .9s linear infinite}@keyframes chuva{from{transform:translateY(-14px)}to{transform:translateY(14px)}}
.cursor{animation:cursor 1s steps(1) infinite}@keyframes cursor{50%{opacity:0}}
.vapor{animation:vapor 2.8s ease-in-out infinite}@keyframes vapor{0%{transform:translateY(2px);opacity:0}40%{opacity:.8}100%{transform:translateY(-3px);opacity:0}}
.estrela{animation:est 2.6s ease-in-out infinite}@keyframes est{50%{opacity:.25}}
.nuvem1{animation:nv 30s linear infinite}.nuvem2{animation:nv 38s linear infinite -14s}@keyframes nv{from{transform:translateX(-24px)}to{transform:translateX(40px)}}
.raio{opacity:0;animation:raio 7s infinite}@keyframes raio{0%,90%,93%,100%{opacity:0}91%,94%{opacity:.6}}
@media (prefers-reduced-motion: reduce){.farol,.chuva,.cursor,.vapor,.estrela,.nuvem1,.nuvem2,.raio{animation:none}.raio{opacity:0}}
</style>
<g shape-rendering="crispEdges">
${corpo}
</g>
</svg>
`;
}

// ---------------------------------------------------------------- cabeçalho (nome, stack, foto)

function chips(lista, x, y, tracejado) {
  let out = '';
  let cx = x;
  for (const item of lista) {
    const w = Math.round(item.length * 8 + 22);
    out += `<rect x="${cx + 0.5}" y="${y + 0.5}" width="${w}" height="28" fill="none" stroke="${tracejado ? COR.destaque : '#4a3a1f'}"${tracejado ? ' stroke-dasharray="3 3"' : ''}/>`;
    out += `<text x="${cx + w / 2}" y="${y + 19}" text-anchor="middle" font-family="${MONO}" font-size="13" fill="${tracejado ? COR.destaque : COR.texto}">${esc(item)}</text>`;
    cx += w + 8;
  }
  return { svg: out, fim: cx };
}

function cabecalho(dados) {
  const W = 880, H = 170;
  const nome = `<path fill="${COR.destaque}" d="${pix(PERFIL.nome, 0, 14, 8)}"/>`;
  const stack = chips(PERFIL.stack, 0, 74, false);
  const rotulo = 'CURRENTLY LEARNING';
  const lab = `<path fill="${COR.apagado}" d="${pix(rotulo, 0, 129, 2)}"/>`;
  const aprendendo = chips(PERFIL.aprendendo, pixW(rotulo, 2) + 16, 120, true);
  const foto = dados.avatar
    ? `<image x="${W - 128}" y="18" width="124" height="124" href="${dados.avatar}" preserveAspectRatio="xMidYMid slice" style="image-rendering:pixelated"/>`
    : `<rect x="${W - 128}" y="18" width="124" height="124" fill="${COR.barra}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${PERFIL.nome}. Stack: ${PERFIL.stack.join(', ')}. Currently learning: ${PERFIL.aprendendo.join(', ')}.`)}">
<g shape-rendering="crispEdges">${nome}${lab}</g>
${stack.svg}
${aprendendo.svg}
${foto}
<rect x="${W - 129}" y="17" width="126" height="126" fill="none" stroke="${COR.destaque}" stroke-width="2" shape-rendering="crispEdges"/>
</svg>
`;
}

// ---------------------------------------------------------------- about.txt

function quebra(texto, max) {
  const linhas = [];
  let atual = '';
  for (const p of texto.split(/\s+/)) {
    if ((atual + ' ' + p).trim().length > max) {
      linhas.push(atual);
      atual = p;
    } else atual = (atual + ' ' + p).trim();
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function sobre() {
  const W = 880;
  const linhas = quebra(PERFIL.sobre, 86);
  const H = 44 + 24 + linhas.length * 25 + 14;
  const txt = linhas.map((l, i) => `<text x="24" y="${44 + 30 + i * 25}" font-family="${MONO}" font-size="15" fill="${COR.texto}">${esc(l)}</text>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(PERFIL.sobre)}">
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" fill="${COR.painel}" stroke="${COR.borda}"/>
<g shape-rendering="crispEdges">
<rect x="1" y="1" width="${W - 2}" height="42" fill="${COR.barra}"/><rect x="1" y="43" width="${W - 2}" height="1" fill="${COR.borda}"/>
<rect x="17" y="18" width="8" height="8" fill="${COR.destaque}"/><rect x="31" y="18" width="8" height="8" fill="#4a3a1f"/><rect x="45" y="18" width="8" height="8" fill="#4a3a1f"/>
<path fill="${COR.texto}" d="${pix('about.txt', 66, 16, 2)}"/>
</g>
${txt}
</svg>
`;
}

// ---------------------------------------------------------------- números

function numeros(dados) {
  const t = agoraSP(dados.now);
  const seq = sequencias(dados.days, t.data);
  const itens = [
    [dados.stats.commits, 'COMMITS NO ANO'],
    [dados.stats.prs, 'PULL REQUESTS'],
    [dados.repos.filter((r) => !r.fork).reduce((s, r) => s + r.stars, 0), 'ESTRELAS'],
    [`${seq.melhor}D`, 'MAIOR SEQUÊNCIA'],
  ];
  const W = 880, H = 112, gap = 12, tw = (W - gap * 3) / 4;
  const tiles = itens
    .map(([n, label], i) => {
      const x = i * (tw + gap);
      return `<g transform="translate(${x} 0)">
  <rect x=".5" y=".5" width="${tw - 1}" height="${H - 1}" fill="${COR.painel}" stroke="${COR.borda}"/>
  <path fill="${COR.destaque}" d="${pix(String(n), 20, 22, 8)}"/>
  <path fill="${COR.apagado}" d="${pix(label, 20, 80, 2)}"/>
</g>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(itens.map(([n, l]) => `${n} ${l.toLowerCase()}`).join(', '))}">
<g shape-rendering="crispEdges">${tiles}</g>
</svg>
`;
}

// ---------------------------------------------------------------- cards de projeto

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h;
}

function cardProjeto(r) {
  const h = hash(r.name);
  let icone = '';
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 4; x++) {
      if (!((h >>> (y * 4 + x)) & 1)) continue;
      for (const xx of x === 3 ? [3] : [x, 6 - x]) icone += `M${26 + xx * 8} ${30 + y * 8}h8v8h-8z`;
    }
  const nome = r.name.length > 20 ? r.name.slice(0, 19) + '.' : r.name;
  const desc = cut(r.description || 'Descrição em breve.', 44);
  const rodape = `${r.language?.name || '—'} · ★ ${r.stars} · ${dataCurta(r.pushedAt)}`;
  const W = 430, H = 124;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${r.name}: ${r.description || 'projeto'}`)}">
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" fill="${COR.painel}" stroke="${COR.borda}"/>
<g shape-rendering="crispEdges">
  <rect x="20" y="24" width="68" height="68" fill="${COR.barra}"/>
  <path fill="${COR.destaque}" d="${icone}"/>
  <path fill="${COR.destaque}" d="${pix(nome, 106, 28, 2.5)}"/>
</g>
<text x="106" y="66" font-family="${MONO}" font-size="13" fill="${COR.texto}">${esc(desc)}</text>
<text x="106" y="92" font-family="${MONO}" font-size="12" fill="${COR.apagado}">${esc(rodape)}</text>
</svg>
`;
}

// ---------------------------------------------------------------- atividade

function atividade(dados) {
  const t = agoraSP(dados.now);
  const seq = sequencias(dados.days, t.data);
  const dias = dados.days.filter((d) => d.date <= t.data);
  const semanas = 30;
  const ultimo = new Date(t.data + 'T12:00:00Z');
  const inicio = new Date(ultimo);
  inicio.setUTCDate(inicio.getUTCDate() - ultimo.getUTCDay() - (semanas - 1) * 7);
  const mapa = new Map(dias.map((d) => [d.date, d.count]));
  const cor = (c) => (c === 0 ? '#1f180d' : c < 4 ? '#4a3517' : c < 10 ? '#8a6328' : COR.destaque);
  const cel = 13, passo = 16, ox = 24, oy = 50;
  let quad = '';
  const d = new Date(inicio);
  for (let w = 0; w < semanas; w++)
    for (let k = 0; k < 7; k++) {
      const iso = d.toISOString().slice(0, 10);
      if (iso <= t.data) quad += `<rect x="${ox + w * passo}" y="${oy + k * passo}" width="${cel}" height="${cel}" fill="${cor(mapa.get(iso) || 0)}"/>`;
      d.setUTCDate(d.getUTCDate() + 1);
    }
  const ly = oy + 7 * passo + 10;
  const legenda = `<text x="${ox}" y="${ly + 10}" font-family="${MONO}" font-size="11" fill="${COR.apagado}">menos</text>` +
    ['#1f180d', '#4a3517', '#8a6328', COR.destaque].map((c, i) => `<rect x="${ox + 44 + i * 15}" y="${ly}" width="11" height="11" fill="${c}"/>`).join('') +
    `<text x="${ox + 110}" y="${ly + 10}" font-family="${MONO}" font-size="11" fill="${COR.apagado}">mais</text>`;
  const px = ox + semanas * passo + 40;
  const bloco = (y, label, valor) =>
    `<text x="${px}" y="${y}" font-family="${MONO}" font-size="12" letter-spacing="1" fill="${COR.apagado}">${label}</text><path fill="${COR.texto}" d="${pix(valor, px, y + 10, 4)}"/>`;
  const W = 880, H = 214;
  const plural = (n) => `${n} ${n === 1 ? 'DIA' : 'DIAS'}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Atividade: sequência atual de ${seq.atual} dias, maior sequência de ${seq.melhor} dias, ${dados.stats.total} contribuições no último ano`)}">
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" fill="${COR.painel}" stroke="${COR.borda}"/>
<g shape-rendering="crispEdges">
<path fill="${COR.destaque}" d="${pix('> atividade', 24, 22, 2)}"/>
${quad}
${legenda}
${bloco(58, 'SEQUÊNCIA ATUAL', plural(seq.atual))}
${bloco(112, 'MAIOR SEQUÊNCIA', plural(seq.melhor))}
${bloco(166, 'NO ÚLTIMO ANO', String(dados.stats.total))}
</g>
</svg>
`;
}

// ---------------------------------------------------------------- README e execução

const INI = '<!-- PROJETOS:INICIO -->';
const FIM = '<!-- PROJETOS:FIM -->';

function blocoProjetos(lista) {
  const imgs = lista.map(
    (r) => `  <a href="${r.url}"><img src="assets/projeto-${r.name}.svg" alt="${esc(`${r.name}: ${r.description || 'ver projeto'}`)}" width="49%" /></a>`,
  );
  return `${INI}\n<p align="left">\n${imgs.join('\n')}\n</p>\n${FIM}`;
}

async function fetchAvatar(login) {
  try {
    const res = await fetch(`https://github.com/${encodeURIComponent(login)}.png?size=40`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const tipo = res.headers.get('content-type') || 'image/png';
    return `data:${tipo};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  } catch {
    return null;
  }
}

async function main() {
  const dados = process.env.DATA_FILE ? JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8')) : await fetchGitHub();
  if (!process.env.DATA_FILE) {
    dados.weather = await fetchClima();
    dados.avatar = await fetchAvatar(dados.login);
  } else if (process.env.AVATAR_FILE) {
    dados.avatar = `data:image/png;base64,${fs.readFileSync(process.env.AVATAR_FILE).toString('base64')}`;
  }
  dados.now = dados.now || new Date().toISOString();

  fs.mkdirSync(OUT, { recursive: true });
  const escreve = (nome, conteudo) => fs.writeFileSync(path.join(OUT, nome), conteudo);
  escreve('sala.svg', sala(dados));
  escreve('cabecalho.svg', cabecalho(dados));
  escreve('sobre.svg', sobre());
  escreve('numeros.svg', numeros(dados));
  escreve('atividade.svg', atividade(dados));

  const ocultos = new Set([dados.login, ...PERFIL.ocultar].map((n) => n.toLowerCase()));
  const projetos = dados.repos.filter((r) => !r.fork && !r.archived && !ocultos.has(r.name.toLowerCase())).slice(0, 4);
  for (const f of fs.readdirSync(OUT)) if (/^projeto-.*\.svg$/.test(f)) fs.unlinkSync(path.join(OUT, f));
  for (const r of projetos) escreve(`projeto-${r.name}.svg`, cardProjeto(r));

  if (fs.existsSync(README)) {
    const md = fs.readFileSync(README, 'utf8');
    const a = md.indexOf(INI);
    const b = md.indexOf(FIM);
    if (a !== -1 && b > a) {
      const novo = md.slice(0, a) + blocoProjetos(projetos) + md.slice(b + FIM.length);
      if (novo !== md) fs.writeFileSync(README, novo);
    }
  }
  console.log(`Gerado: sala, cabeçalho, about, números, atividade e ${projetos.length} projeto(s). Clima: ${dados.weather ? `${dados.weather.temp}°C código ${dados.weather.code}` : 'sem dados'}. Foto: ${dados.avatar ? 'ok' : 'sem foto'}.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { sequencias, pix, pixW, tipoClima, sala, cabecalho, sobre, numeros, atividade, cardProjeto, quebra };
