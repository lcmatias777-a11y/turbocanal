// Conferencias da TELA que nenhum teste de servidor pega, porque o erro esta
// no HTML que o navegador monta:
//
//  1) interpolacao dentro de atributo onclick= ou src= sem passar por esc().
//     Sem esc(), as aspas do proprio valor fecham o atributo: o navegador
//     compila um handler quebrado e o botao fica MUDO, sem erro nenhum na tela.
//     Foi assim que os tres botoes "copiar" (chave da live, codigo Pix e token
//     da extensao) ficaram sem fazer nada.
//
//  2) acao administrativa que pode virar PEDIDO e a tela nao avisa.
//     Admin nao principal recebe 202 com executado=false. Se o handler nao
//     olhar isso, ele clica, nada muda no site e ninguem explica por que.
import { readFileSync, readdirSync } from 'node:fs';
const RAIZ = '/home/claude/turbocanal';
let falhas = 0, checks = 0;
const ok = (cond, nome) => { checks++; if (!cond) { falhas++; console.log('  FALHOU: ' + nome); } };

/* ---------- 1) atributos que viram codigo ou endereco ---------- */
// Nestes dois atributos o valor e executado (onclick) ou buscado (src), entao
// qualquer aspas solta quebra a pagina de verdade. esc() resolve os dois.
const PERIGOSOS = ['onclick', 'src'];
const attr = new RegExp(`\\s(${PERIGOSOS.join('|')})="([^"\\n]*\\$\\{[^"\\n]*)"`, 'g');
const arquivos = readdirSync(RAIZ + '/web/assets').filter((f) => f.endsWith('.js'));
let interpolacoes = 0;
for (const f of arquivos) {
  const linhas = readFileSync(`${RAIZ}/web/assets/${f}`, 'utf8').split('\n');
  linhas.forEach((linha, i) => {
    attr.lastIndex = 0;
    let m;
    while ((m = attr.exec(linha))) {
      for (const pedaco of m[2].match(/\$\{[^}]*\}/g) || []) {
        interpolacoes++;
        ok(/esc\(|encodeURIComponent\(/.test(pedaco),
          `${f}:${i + 1} atributo ${m[1]}= com ${pedaco.slice(0, 60)} sem esc()`);
      }
    }
  });
}
console.log(`  (${interpolacoes} interpolacoes em onclick=/src= conferidas)`);

/* ---------- 2) toda rota que passa pela fila tem de avisar na tela ---------- */
const rotasDaFila = [];
for (const f of readdirSync(RAIZ + '/server/src').filter((x) => x.endsWith('.js'))) {
  const linhas = readFileSync(`${RAIZ}/server/src/${f}`, 'utf8').split('\n');
  let atual = null;
  linhas.forEach((l, i) => {
    const m = /app\.(get|post|put|delete|patch)\(\s*'([^']+)'/.exec(l);
    if (m) atual = { metodo: m[1].toUpperCase(), caminho: m[2], arq: f, linha: i + 1 };
    if (/pedirOuFazer\(db,/.test(l) && atual) { rotasDaFila.push(atual); atual = null; }
  });
}
ok(rotasDaFila.length >= 20, `achou as rotas da fila (achou ${rotasDaFila.length})`);

const front = readFileSync(RAIZ + '/web/assets/app.js', 'utf8').split('\n');
for (const r of rotasDaFila) {
  const base = r.caminho.replace(/^\/api/, '').split('/:')[0];
  let avisa = false, achou = false;
  front.forEach((l, i) => {
    if (!(l.includes("'" + base) || l.includes('`' + base) || l.includes(base + "'") || l.includes(base + '/'))) return;
    achou = true;
    if (/feitoOuPedido|executado/.test(front.slice(Math.max(0, i - 6), i + 8).join('\n'))) avisa = true;
  });
  ok(!achou || avisa, `${r.metodo} ${r.caminho} (${r.arq}:${r.linha}) vira pedido e a tela nao avisa`);
}

/* ---------- 3) frase fixa de YouTube em mensagem de sucesso ---------- */
// No canal de teste nada sai do site. Uma frase "no YouTube" fora de um
// galho que olha noTeste()/teste/destino() estaria mentindo para quem testa.
const appJs = readFileSync(RAIZ + '/web/assets/app.js', 'utf8').split('\n');
appJs.forEach((l, i) => {
  if (!/alertBox\('ok'|msg\([^,]+, 'ok'/.test(l)) return;
  if (!/YouTube/.test(l)) return;
  const contexto = appJs.slice(Math.max(0, i - 3), i + 3).join('\n');
  ok(/noTeste\(\)|destino\(\)|\.teste|teste \?/.test(contexto),
    `app.js:${i + 1} mensagem de sucesso promete YouTube sem olhar o canal de teste`);
});

console.log(falhas ? `tela-test: ${falhas} de ${checks} FALHARAM` : `tela-test: ${checks} verificacoes, todas passaram`);
process.exit(falhas ? 1 : 0);
