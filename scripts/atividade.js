#!/usr/bin/env node
'use strict';
// Atualiza a seção "Atividade recente" do README com o último commit de cada repositório
// público em que você mexeu por último. Roda no GitHub Actions (veja .github/workflows/perfil.yml).
//
// Escreve só entre os marcadores <!-- ATIVIDADE:INICIO --> e <!-- ATIVIDADE:FIM -->.
// Variáveis: GITHUB_TOKEN (o Actions fornece), GH_USER (padrão: dono do repositório),
// MAX_REPOS (padrão 4), README (padrão README.md), API_BASE (só pra teste).

const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');

const API = (process.env.API_BASE || 'https://api.github.com').replace(/\/+$/, '');
const USER = process.env.GH_USER || (process.env.GITHUB_REPOSITORY || '').split('/')[0];
const TOKEN = process.env.GITHUB_TOKEN || '';
const MAX = Number(process.env.MAX_REPOS || 4);
const README = process.env.README || 'README.md';
const START = '<!-- ATIVIDADE:INICIO -->';
const END = '<!-- ATIVIDADE:FIM -->';

function get(path) {
  const url = new URL(API + path);
  const lib = url.protocol === 'http:' ? http : https;
  const headers = { 'User-Agent': 'perfil-atividade', Accept: 'application/vnd.github+json' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  return new Promise((resolve, reject) => {
    lib
      .get(url, { headers }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode === 409) return resolve([]); // repositório vazio
          if (res.statusCode >= 400) return reject(new Error(`${res.statusCode} em ${path}: ${body.slice(0, 200)}`));
          resolve(JSON.parse(body));
        });
      })
      .on('error', reject);
  });
}

// data fixa (ex.: "12 out"): o README só muda quando você realmente mexer em algum repositório
function shortDate(iso) {
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return `${d.getDate()} ${meses[d.getMonth()]}`;
}

// texto vindo de commit vai pro Markdown: neutraliza o que poderia virar HTML ou link
function clean(text) {
  return String(text)
    .split('\n')[0]
    .replace(/[<>]/g, '')
    .replace(/([\\`*_\[\]|])/g, '\\$1')
    .slice(0, 90);
}

async function build() {
  if (!USER) throw new Error('Não sei qual usuário consultar (defina GH_USER).');
  const repos = await get(`/users/${encodeURIComponent(USER)}/repos?sort=pushed&per_page=20&type=owner`);
  const picked = repos.filter((r) => !r.fork && !r.archived && r.name.toLowerCase() !== USER.toLowerCase()).slice(0, MAX);

  const lines = [];
  for (const r of picked) {
    const commits = await get(`/repos/${r.full_name}/commits?per_page=1`);
    const c = commits[0];
    if (!c) continue;
    const when = c.commit.committer?.date || c.commit.author?.date || r.pushed_at;
    lines.push(`- **[${clean(r.name)}](${r.html_url})** · ${clean(c.commit.message)} · <sub>${shortDate(when)}</sub>`);
  }
  if (!lines.length) lines.push('- Nada público por aqui ainda. Volta daqui a pouco.');

  return `${START}\n${lines.join('\n')}\n${END}`;
}

async function main() {
  const readme = fs.readFileSync(README, 'utf8');
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a === -1 || b === -1 || b < a) throw new Error(`Marcadores ${START} / ${END} não encontrados em ${README}`);
  const block = await build();
  const next = readme.slice(0, a) + block + readme.slice(b + END.length);
  if (next === readme) return console.log('Sem mudanças.');
  fs.writeFileSync(README, next);
  console.log('README atualizado:\n' + block);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { shortDate, clean };
