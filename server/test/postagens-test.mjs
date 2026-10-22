// Postagens (pública e de administradores) e enquetes entre administradores.

delete process.env.DATABASE_URL;
process.env.YT_MOCK = '1';
process.env.PASSWORD_LOGIN = '1';
process.env.OWNER_EMAIL = 'dono@example.com';

import { randomUUID } from 'node:crypto';
const { buildApp } = await import('../src/app.js');
const { app, db } = await buildApp({ databaseUrl: undefined, dataDir: ':memory:', scheduler: false });
const { apurar, lerOpcoes } = await import('../src/enquetes.js');
const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const { signToken } = await import('../src/auth.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('  PASSOU  ' + n); } else { fail++; console.log('  FALHOU  ' + n + ' ' + x); } return !!c; };
async function req(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {}; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function criar(email, nome, role = 'user') {
  const id = randomUUID();
  await db.run('INSERT INTO users(id,email,pass_hash,name,role,plan_id,credits,created_at) VALUES(?,?,?,?,?,?,?,?)',
    [id, email, null, nome, role, 'free', 5000, new Date().toISOString()]);
  return { id, email, nome, token: await signToken(db, id) };
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAJ0lEQVR42u3OMQEAAAgDoC251a3gLzSgce+QAAECBAgQIECAAAECBO4WUQAB2YfC7wAAAABJRU5ErkJggg==';

const dono = await criar('dono@example.com', 'Dono', 'owner');
const adm = await criar('adm@example.com', 'Admin Dois', 'admin');
const adm2 = await criar('adm3@example.com', 'Admin Tres', 'admin');
const ana = await criar('ana@example.com', 'Ana');
const bia = await criar('bia@example.com', 'Bia');

console.log('\n== O dono publica na hora; admin comum PEDE ==');
const pubDono = await req('/api/postagens', { method: 'POST', token: dono.token, body: { area: 'publica', titulo: 'Bem-vindos ao TurboCanal', texto: 'Postagem de abertura do site.', imagem: PNG } });
check('o dono publica direto', pubDono.status === 200 && pubDono.data.executado === true, JSON.stringify(pubDono.data).slice(0, 110));
const pedeAdm = await req('/api/postagens', { method: 'POST', token: adm.token, body: { area: 'publica', titulo: 'Postagem do admin', texto: 'teste' } });
check('admin não principal vira pedido', pedeAdm.status === 202 && pedeAdm.data.executado === false, JSON.stringify(pedeAdm.data).slice(0, 110));
check('o pedido diz o que será publicado', /publicar "Postagem do admin"/.test(pedeAdm.data.frase || ''), pedeAdm.data.frase);
check('e a postagem ainda não existe', Number((await db.get("SELECT COUNT(*) AS n FROM postagens WHERE titulo='Postagem do admin'")).n) === 0);
await req(`/api/admin/pedidos/${pedeAdm.data.pedido}/decidir`, { method: 'POST', token: dono.token, body: { decisao: 'sim' } });
check('depois do Sim ela aparece', Number((await db.get("SELECT COUNT(*) AS n FROM postagens WHERE titulo='Postagem do admin'")).n) === 1);
const semSer = await req('/api/postagens', { method: 'POST', token: ana.token, body: { area: 'publica', titulo: 'x', texto: 'y' } });
check('usuário comum não publica nem pedindo', semSer.status === 403, String(semSer.status));

console.log('\n== Quem lê o quê ==');
const listaAna = await req('/api/postagens?area=publica', { token: ana.token });
check('usuário comum lê a área pública', listaAna.status === 200 && listaAna.data.itens.length === 2, String(listaAna.data.itens?.length));
check('e vê a imagem da postagem', listaAna.data.itens.some((p) => p.imagem === PNG));
check('e sabe que não pode publicar', listaAna.data.podePublicar === false);
const admArea = await req('/api/postagens?area=admin', { token: ana.token });
check('usuário comum NÃO lê a área de administradores', admArea.status === 403, String(admArea.status));
await req('/api/postagens', { method: 'POST', token: dono.token, body: { area: 'admin', titulo: 'Combinado interno', texto: 'só para a equipe' } });
const admOk = await req('/api/postagens?area=admin', { token: adm.token });
check('administrador lê a área dele', admOk.status === 200 && admOk.data.itens.length === 1);
const pubLista = await req('/api/postagens?area=publica', { token: ana.token });
check('a postagem interna NÃO vaza para a área pública', !pubLista.data.itens.some((p) => /Combinado interno/.test(p.titulo)));
check('área inválida é recusada', (await req('/api/postagens?area=secreta', { token: dono.token })).status === 400);

console.log('\n== O filtro vale na área pública, inclusive para o dono ==');
const proibida = await req('/api/postagens', { method: 'POST', token: dono.token, body: { area: 'publica', titulo: 'Promoção', texto: 'me chama no zap 54 98439-8807' } });
check('postagem pública com telefone é recusada, mesmo do dono', proibida.status === 422, `(${proibida.status}) ${JSON.stringify(proibida.data).slice(0, 110)}`);
const interna = await req('/api/postagens', { method: 'POST', token: dono.token, body: { area: 'admin', titulo: 'Contato do contador', texto: 'o telefone dele é 54 98439-8807' } });
check('na área interna o mesmo texto passa (é gente de confiança)', interna.status === 200, String(interna.status));

console.log('\n== Curtir e não curtir ==');
const post = listaAna.data.itens[listaAna.data.itens.length - 1];
const c1 = await req(`/api/postagens/${post.id}/reagir`, { method: 'POST', token: ana.token, body: { valor: 1 } });
check('curtir conta', c1.data.curtidas === 1 && c1.data.minhaReacao === 1, JSON.stringify(c1.data));
const c2 = await req(`/api/postagens/${post.id}/reagir`, { method: 'POST', token: ana.token, body: { valor: 1 } });
check('curtir de novo desfaz', c2.data.curtidas === 0 && c2.data.minhaReacao === 0, JSON.stringify(c2.data));
await req(`/api/postagens/${post.id}/reagir`, { method: 'POST', token: ana.token, body: { valor: 1 } });
const c3 = await req(`/api/postagens/${post.id}/reagir`, { method: 'POST', token: ana.token, body: { valor: -1 } });
check('trocar curtida por descurtida não soma as duas', c3.data.curtidas === 0 && c3.data.descurtidas === 1, JSON.stringify(c3.data));
await req(`/api/postagens/${post.id}/reagir`, { method: 'POST', token: bia.token, body: { valor: 1 } });
const c4 = await req(`/api/postagens/${post.id}/reagir`, { method: 'POST', token: dono.token, body: { valor: 1 } });
check('cada pessoa conta uma vez', c4.data.curtidas === 2 && c4.data.descurtidas === 1, JSON.stringify(c4.data));
check('valor inválido é recusado', (await req(`/api/postagens/${post.id}/reagir`, { method: 'POST', token: ana.token, body: { valor: 5 } })).status === 400);
const postAdmin = (await req('/api/postagens?area=admin', { token: adm.token })).data.itens[0];
check('usuário comum não reage em postagem da área de admin',
  (await req(`/api/postagens/${postAdmin.id}/reagir`, { method: 'POST', token: ana.token, body: { valor: 1 } })).status === 403);

console.log('\n== Comentários ==');
const com1 = await req(`/api/postagens/${post.id}/comentarios`, { method: 'POST', token: ana.token, body: { texto: 'muito bom, obrigada!' } });
check('usuário comum comenta na área pública', com1.status === 200 && com1.data.comentario.texto === 'muito bom, obrigada!');
const comFiltro = await req(`/api/postagens/${post.id}/comentarios`, { method: 'POST', token: bia.token, body: { texto: 'me chama no insta' } });
check('comentário público passa pelo filtro', comFiltro.status === 422, `(${comFiltro.status}) ${JSON.stringify(comFiltro.data).slice(0, 100)}`);
const comImgPub = await req(`/api/postagens/${post.id}/comentarios`, { method: 'POST', token: ana.token, body: { texto: 'olha isso', imagem: PNG } });
check('imagem em comentário público é recusada', comImgPub.status === 400, `(${comImgPub.status}) ${JSON.stringify(comImgPub.data).slice(0, 100)}`);
const comImgAdm = await req(`/api/postagens/${postAdmin.id}/comentarios`, { method: 'POST', token: adm.token, body: { texto: 'segue o print', imagem: PNG } });
check('imagem em comentário da área de admin é aceita', comImgAdm.status === 200 && comImgAdm.data.comentario.imagem === PNG, JSON.stringify(comImgAdm.data).slice(0, 110));
check('usuário comum não comenta na área de admin',
  (await req(`/api/postagens/${postAdmin.id}/comentarios`, { method: 'POST', token: ana.token, body: { texto: 'oi' } })).status === 403);
const lista = await req(`/api/postagens/${post.id}/comentarios`, { token: bia.token });
check('os comentários aparecem com autor e avatar', lista.data.itens.length === 1 && lista.data.itens[0].autor.inicial === 'A', JSON.stringify(lista.data.itens[0] || {}).slice(0, 130));
check('a tela sabe se aquela área aceita imagem', lista.data.aceitaImagem === false
  && (await req(`/api/postagens/${postAdmin.id}/comentarios`, { token: adm.token })).data.aceitaImagem === true);
check('o autor da postagem foi avisado do comentário',
  Number((await db.get("SELECT COUNT(*) AS n FROM notificacoes WHERE tipo='resposta_recebida' AND user_id=?", [dono.id])).n) >= 1);
const comId = com1.data.comentario.id;
check('quem comentou apaga o próprio comentário',
  (await req(`/api/postagens/comentarios/${comId}`, { method: 'DELETE', token: ana.token })).data.executado === true);
const com2 = await req(`/api/postagens/${post.id}/comentarios`, { method: 'POST', token: bia.token, body: { texto: 'comentario da bia' } });
check('outro usuário comum não apaga comentário alheio',
  (await req(`/api/postagens/comentarios/${com2.data.comentario.id}`, { method: 'DELETE', token: ana.token })).status === 403);
const admApaga = await req(`/api/postagens/comentarios/${com2.data.comentario.id}`, { method: 'DELETE', token: adm.token, body: { motivo: 'x' } });
check('admin não principal PEDE para apagar comentário alheio', admApaga.status === 202 && admApaga.data.executado === false);
check('o dono apaga na hora',
  (await req(`/api/postagens/comentarios/${com2.data.comentario.id}`, { method: 'DELETE', token: dono.token })).data.executado === true);

console.log('\n== Editar e excluir postagem ==');
const edi = await req(`/api/postagens/${post.id}`, { method: 'PUT', token: dono.token, body: { titulo: 'Título trocado', texto: 'texto novo' } });
check('o dono edita na hora', edi.status === 200 && edi.data.executado === true);
check('e o título mudou', (await db.get('SELECT titulo FROM postagens WHERE id=?', [post.id])).titulo === 'Título trocado');
const ediAdm = await req(`/api/postagens/${post.id}`, { method: 'PUT', token: adm.token, body: { titulo: 'Mexido pelo admin', texto: 'texto' } });
check('admin não principal pede para editar', ediAdm.status === 202 && ediAdm.data.executado === false);
check('e o título NÃO mudou antes do Sim', (await db.get('SELECT titulo FROM postagens WHERE id=?', [post.id])).titulo === 'Título trocado');
const exAdm = await req(`/api/postagens/${post.id}`, { method: 'DELETE', token: adm.token, body: { motivo: 'limpeza' } });
check('admin não principal pede para excluir', exAdm.status === 202 && exAdm.data.executado === false);
check('a postagem continua no ar', (await db.get('SELECT status FROM postagens WHERE id=?', [post.id])).status === 'ativa');
await req(`/api/admin/pedidos/${exAdm.data.pedido}/decidir`, { method: 'POST', token: dono.token, body: { decisao: 'nao', resposta: 'não autorizo' } });
check('com o Não, ela continua no ar', (await db.get('SELECT status FROM postagens WHERE id=?', [post.id])).status === 'ativa');
const exDono = await req(`/api/postagens/${post.id}`, { method: 'DELETE', token: dono.token, body: { motivo: 'minha decisão' } });
check('o dono exclui na hora', exDono.data.executado === true && (await db.get('SELECT status FROM postagens WHERE id=?', [post.id])).status === 'excluida');
check('e ela some da lista', !(await req('/api/postagens?area=publica', { token: ana.token })).data.itens.some((p) => p.id === post.id));

console.log('\n== Imagem: o que não é aceito ==');
for (const [nome, img, esperado] of [
  ['SVG (pode carregar script)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 400],
  ['link em vez de imagem', 'https://site.com/a.png', 400],
  ['imagem grande demais', 'data:image/png;base64,' + 'A'.repeat(1_100_000), 413]
]) {
  const r = await req('/api/postagens', { method: 'POST', token: dono.token, body: { area: 'publica', titulo: 'teste', texto: 'teste', imagem: img } });
  check(`recusa ${nome}`, r.status === esperado, `(${r.status})`);
}

console.log('\n== Enquetes: apuração ==');
check('sem voto, tudo zero', apurar(['a', 'b'], []).total === 0);
const ap = apurar(['a', 'b', 'c'], [{ opcao: 0 }, { opcao: 0 }, { opcao: 1 }]);
check('conta os votos certo', ap.opcoes[0].votos === 2 && ap.opcoes[1].votos === 1 && ap.opcoes[2].votos === 0);
check('as porcentagens fecham em 100', ap.opcoes.reduce((s, o) => s + o.percentual, 0) === 100, JSON.stringify(ap.opcoes.map((o) => o.percentual)));
const ap3 = apurar(['a', 'b', 'c'], [{ opcao: 0 }, { opcao: 1 }, { opcao: 2 }]);
check('e fecham mesmo com divisão por três', ap3.opcoes.reduce((s, o) => s + o.percentual, 0) === 100, JSON.stringify(ap3.opcoes.map((o) => o.percentual)));
check('opções repetidas viram uma só', lerOpcoes(['sim', 'sim', 'não']).length === 2);
let erro = ''; try { lerOpcoes(['so uma']); } catch (e) { erro = e.message; }
check('menos de duas opções é recusado', /pelo menos 2/.test(erro), erro);

console.log('\n== Enquetes: quem abre, quem vota ==');
const admTenta = await req('/api/admin/enquetes', { method: 'POST', token: adm.token, body: { pergunta: 'posso?', opcoes: ['sim', 'não'] } });
check('admin não principal NÃO abre enquete', admTenta.status === 403, String(admTenta.status));
const enq = await req('/api/admin/enquetes', { method: 'POST', token: dono.token, body: { pergunta: 'Mudamos o preço da auditoria?', opcoes: ['Sim', 'Não', 'Depois'] } });
check('o dono abre a enquete', enq.status === 200 && !!enq.data.id, JSON.stringify(enq.data).slice(0, 100));
check('e os administradores são avisados', enq.data.avisados === 2, String(enq.data.avisados));
const antes = await req('/api/admin/enquetes', { token: adm.token });
check('antes de votar, o resultado fica escondido', antes.data.itens[0].resultado.escondido === true, JSON.stringify(antes.data.itens[0].resultado).slice(0, 110));
const voto = await req(`/api/admin/enquetes/${enq.data.id}/votar`, { method: 'POST', token: adm.token, body: { opcao: 0 } });
check('o administrador vota', voto.status === 200 && voto.data.meuVoto === 0, JSON.stringify(voto.data).slice(0, 110));
check('e aí vê o resultado', voto.data.resultado.escondido !== true && voto.data.resultado.total === 1);
const revoto = await req(`/api/admin/enquetes/${enq.data.id}/votar`, { method: 'POST', token: adm.token, body: { opcao: 1 } });
check('trocar o voto não cria um voto a mais', revoto.data.resultado.total === 1 && revoto.data.meuVoto === 1, JSON.stringify(revoto.data.resultado));
await req(`/api/admin/enquetes/${enq.data.id}/votar`, { method: 'POST', token: adm2.token, body: { opcao: 1 } });
const comDois = await req('/api/admin/enquetes', { token: dono.token });
check('dois votos contam dois', comDois.data.itens[0].resultado.total === 2);
check('o dono vê quem votou em quê', Array.isArray(comDois.data.itens[0].quemVotou) && comDois.data.itens[0].quemVotou.length === 2, JSON.stringify(comDois.data.itens[0].quemVotou || []).slice(0, 110));
const comumEnq = await req('/api/admin/enquetes', { token: ana.token });
check('usuário comum não vê enquete nenhuma', comumEnq.status === 403, String(comumEnq.status));
check('opção que não existe é recusada', (await req(`/api/admin/enquetes/${enq.data.id}/votar`, { method: 'POST', token: adm.token, body: { opcao: 9 } })).status === 400);

console.log('\n== Enquete a partir de um pedido ==');
const pedido = await req('/api/postagens', { method: 'POST', token: adm.token, body: { area: 'publica', titulo: 'Postagem polêmica', texto: 'conteudo' } });
const enqPed = await req('/api/admin/enquetes', { method: 'POST', token: dono.token, body: { pergunta: 'Aprovo esta postagem?', opcoes: ['Sim', 'Não'], pedido_id: pedido.data.pedido } });
check('dá para abrir enquete sobre um pedido da fila', enqPed.status === 200, JSON.stringify(enqPed.data).slice(0, 100));
const listaEnq = await req('/api/admin/enquetes', { token: dono.token });
check('a enquete fica ligada ao pedido', listaEnq.data.itens.some((e) => e.pedido_id === pedido.data.pedido));
check('mas a enquete NÃO decide o pedido sozinha', (await db.get('SELECT status FROM pedidos_admin WHERE id=?', [pedido.data.pedido])).status === 'pendente');
check('pedido já decidido não aceita enquete nova',
  (await req('/api/admin/enquetes', { method: 'POST', token: dono.token, body: { pergunta: 'x', opcoes: ['a', 'b'], pedido_id: 'naoexiste' } })).status === 404);

console.log('\n== Fechar e apagar enquete ==');
const fecha = await req(`/api/admin/enquetes/${enq.data.id}/fechar`, { method: 'POST', token: dono.token });
check('o dono fecha a enquete', fecha.status === 200);
check('e fechada não aceita mais voto',
  (await req(`/api/admin/enquetes/${enq.data.id}/votar`, { method: 'POST', token: adm2.token, body: { opcao: 0 } })).status === 409);
check('admin não principal não fecha', (await req(`/api/admin/enquetes/${enqPed.data.id}/fechar`, { method: 'POST', token: adm.token })).status === 403);
check('admin não principal não apaga', (await req(`/api/admin/enquetes/${enqPed.data.id}`, { method: 'DELETE', token: adm.token })).status === 403);
const apaga = await req(`/api/admin/enquetes/${enq.data.id}`, { method: 'DELETE', token: dono.token });
check('o dono apaga', apaga.status === 200 && Number((await db.get('SELECT COUNT(*) AS n FROM enquetes WHERE id=?', [enq.data.id])).n) === 0);
check('e os votos dela vão junto', Number((await db.get('SELECT COUNT(*) AS n FROM enquete_votos WHERE enquete_id=?', [enq.data.id])).n) === 0);

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam.`);
server.close();
process.exit(fail ? 1 : 0);
