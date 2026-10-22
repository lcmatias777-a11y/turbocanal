// O filtro do bate-papo público.
//
// A razão de este teste existir: com IA eu não consigo PROVAR que um telefone
// nunca passa. Com regra escrita, consigo, e é isso que está aqui. Cada caso
// é uma tentativa real de burlar, não um exemplo bonito.

import { filtrar, normalizar } from '../src/filtro.js';

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU  ' + n); } else { fail++; console.log('  FALHOU  ' + n + ' ' + x); } return !!c; };
const corta = (t) => filtrar(t);
// "cortou" = o trecho perigoso não sobrou inteiro no texto que vai para a tela
const sumiu = (t, pedaco) => !corta(t).texto.toLowerCase().includes(String(pedaco).toLowerCase());

console.log('\n== Mensagem normal não é mexida ==');
for (const t of [
  'oi gente, alguém assiste canal de minecraft?',
  'gravei um vídeo de 12 minutos ontem e rendeu bem',
  'qual programa vocês usam para editar?',
  'consegui 300 inscritos esse mês, tô feliz',
  'o vídeo tem 1080p e 60 fps'
]) check(`passa limpa: "${t.slice(0, 42)}…"`, corta(t).limpo === true, JSON.stringify(corta(t).motivos));

console.log('\n== O risco inverso: filtro rígido demais trava conversa normal ==');
const normais = [
  'alguem sabe por que meu video travou em 200 views?',
  'troquei a capa e subiu 30%, valeu a dica',
  'uso o editor do proprio site, acho bem pratico',
  'meu nicho e jogo de terror, e voces?',
  'publiquei quinta as 19h e foi melhor que sabado',
  'o raio-x disse que meu video de 8 minutos retem mais',
  'ja tentaram short de 45 segundos? ta rendendo aqui',
  'minha retencao media ta em 42 por cento',
  'comprei um microfone novo semana passada',
  'bom dia pessoal, bora gravar hoje',
  'o auxilio da IA ajudou no titulo, ficou melhor',
  'to com 847 inscritos, falta pouco pra mil'
];
let travadas = 0;
for (const t of normais) { const r = corta(t); if (!r.limpo) { travadas++; console.log(`    (travou) "${t}" -> ${JSON.stringify(r.motivos)}`); } }
check(`as ${normais.length} mensagens normais de criador passam inteiras`, travadas === 0, `${travadas} travaram`);

console.log('\n== Link, de todo jeito que dá para escrever ==');
for (const t of [
  'entra em https://site-pirata.com/promo',
  'olha www.vendedeconta.net',
  'meusite.com.br tem mais barato',
  'segue no bit.ly/xyz',
  'acessa meucanal ponto com',
  'ta no discord.gg/abc'
]) check(`corta link: "${t.slice(0, 40)}…"`, corta(t).limpo === false, JSON.stringify(corta(t)));

console.log('\n== Telefone, com e sem disfarce ==');
for (const [t, p] of [
  ['meu numero é 54 98439-8807', '98439'],
  ['liga 11999887766', '11999887766'],
  ['chama no 5 4 9 8 4 3 9 8 8 0 7', '98439'],
  ['(54) 9843-98807 fala comigo', '9843'],
  ['tel: 54.98439.8807', '98439']
]) check(`corta telefone: "${t.slice(0, 36)}…"`, sumiu(t, p), corta(t).texto);
check('mas "1080p" e "60 fps" continuam inteiros', corta('gravo em 1080p a 60 fps').limpo === true);
check('e "2026" não vira telefone', corta('isso foi em 2026').limpo === true);

console.log('\n== E-mail, CPF, CEP e cartão ==');
check('corta e-mail', sumiu('manda pra fulano@gmail.com', 'fulano@gmail.com'));
check('corta CPF', sumiu('meu cpf é 123.456.789-00', '123.456.789-00'));
check('corta CEP', sumiu('meu cep 99200-000', '99200-000'));
check('corta número de cartão', sumiu('4111 1111 1111 1111', '4111 1111 1111 1111'));

console.log('\n== Levar a conversa para fora do site ==');
for (const t of [
  'me chama no whatsapp',
  'chama no zap',
  'vamo pro discord',
  'me segue no instagram',
  'meu insta é esse',
  'te mando no telegram',
  'z a p a i',
  'wh4ts'
]) check(`corta contato externo: "${t}"`, corta(t).limpo === false, JSON.stringify(corta(t).motivos));

console.log('\n== Dinheiro e compra ==');
for (const t of [
  'vendo conta com 10 mil inscritos',
  'faço pix na hora',
  'mando o boleto depois',
  'compro seu canal',
  'ganhe dinheiro em casa',
  'tenho cupom de desconto'
]) check(`corta compra: "${t.slice(0, 34)}…"`, corta(t).limpo === false, JSON.stringify(corta(t).motivos));

console.log('\n== Endereço e encontro ==');
for (const t of [
  'moro na rua das flores 123',
  'avenida brasil 400 aqui',
  'onde voce mora?',
  'qual seu endereco'
]) check(`corta endereço/encontro: "${t.slice(0, 32)}…"`, corta(t).limpo === false, JSON.stringify(corta(t).motivos));

console.log('\n== Dado pessoal e ofensa ==');
check('corta pedido de foto pessoal', corta('manda foto sua').limpo === false);
check('corta pergunta de idade', corta('quantos anos voce tem').limpo === false);
check('corta ofensa', corta('seu idiota').limpo === false);
check('corta ameaça', corta('vou te matar').limpo === false, JSON.stringify(corta('vou te matar').motivos));

console.log('\n== O que foi cortado vira # e nunca vaza ==');
const r = corta('meu zap é 54 98439-8807 e meu email é a@b.com');
check('o texto que sai tem # no lugar', /#{3,}/.test(r.texto), r.texto);
check('e não sobrou nada do telefone', !r.texto.includes('98439'), r.texto);
check('nem do e-mail', !r.texto.includes('a@b.com'), r.texto);
check('mensagem com três ou mais problemas é BLOQUEADA, não só tapada', r.bloqueado === true, JSON.stringify(r.motivos));
check('e o aviso diz o motivo sem repetir o que foi filtrado', /não enviada/i.test(r.aviso) && !r.aviso.includes('98439'), r.aviso);

const so = corta('seu idiota');
check('um problema só é tapado, não bloqueia a mensagem inteira', so.bloqueado === false && so.limpo === false, JSON.stringify(so));
check('e o aviso explica o que sumiu', /escondida/i.test(so.aviso), so.aviso);

console.log('\n== O que tira a conversa do site bloqueia sozinho ==');
for (const t of ['entra em https://x.com', 'manda em fulano@gmail.com', 'liga 11999887766', 'me chama no zap']) {
  check(`um só já bloqueia: "${t.slice(0, 30)}…"`, corta(t).bloqueado === true, JSON.stringify(corta(t).motivos));
}

console.log('\n== Mensagem que vira só # não é enviada ==');
check('texto inteiro filtrado é bloqueado', corta('https://a.com').bloqueado === true || corta('https://a.com').texto.replace(/\s/g, '').replace(/#/g, '') === '');

console.log('\n== Normalização dos disfarces ==');
const n = normalizar('W h 4 t s (arroba) G m a i l (ponto) c o m');
check('junta letras separadas', n.colado.includes('whats'), n.colado);
check('entende (arroba) e (ponto)', n.colado.includes('@') && n.colado.includes('.'), n.colado);

console.log('\n== Nada de quebrar com entrada estranha ==');
for (const t of [null, undefined, '', '   ', '😀😀😀', 'a'.repeat(5000), '###', '....', '@@@@']) {
  let ok = true;
  try { filtrar(t); } catch { ok = false; }
  check(`aguenta entrada "${String(t).slice(0, 14)}"`, ok);
}

console.log('\n== Endereço disfarçado NO MEIO da frase ==');
// Juntar tudo ("colado") apaga a borda de palavra de que a regra de site
// precisa: "meucanal ponto com que tem" virava "meucanal.comquetem" e o
// endereço passava batido. Sozinho era pego; no meio da frase, não.
for (const t of [
  'entra em meucanal ponto com que tem promocao',
  'meucanal ponto com',
  'fulano arroba gmail ponto com me manda',
  'manda no w w w . m e u s i t e . c o m agora',
  'olha esse t i k t o k ponto com barra eu',
  'segue no insta: m e u . i n s t a . c o m'
]) check(`bloqueia disfarce: "${t.slice(0, 34)}…"`, corta(t).bloqueado === true, JSON.stringify(corta(t).motivos));

console.log('\n== E a palavra "ponto" na frase normal continua passando ==');
for (const t of [
  'meu canal e muito bom, e ponto final',
  'o ponto de encontro foi otimo',
  'obrigado ponto comecei a usar hoje',
  'vou ponto comprar o plano pro',
  'a b c d e primeira vez aqui',
  'achei o video otimo, da pra ver que deu trabalho'
]) check(`não bloqueia sem motivo: "${t.slice(0, 34)}…"`, corta(t).bloqueado === false, JSON.stringify(corta(t).motivos));

const nd = normalizar('W W W (ponto) m e u s i t e (ponto) c o m');
check('a versão "dedo" junta o endereço soletrado sem colar as outras palavras',
  /www\.meusite\.com/.test(nd.dedo), nd.dedo);
check('a versão "justo" cola só o ponto e o arroba',
  normalizar('fulano arroba gmail ponto com e amanha').justo === 'fulano@gmail.com e amanha',
  normalizar('fulano arroba gmail ponto com e amanha').justo);

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
process.exit(fail ? 1 : 0);
