// Avisos e cards que o administrador cria e posiciona pelo painel, sem mexer em código.
// Regras: só administradores escrevem (verificado no servidor, não só escondendo botão),
// o visitante só vê o que está publicado, e o endereço do link não aparece a não ser
// que o administrador peça. Tudo fica no banco e sobrevive a recarregar e reiniciar.
import { HttpError, uid, now } from './util.js';

// Posições que EXISTEM mesmo no layout do site (não invento lugar que não dá para encaixar)
export const SLOTS = [
  { id: 'topo', nome: 'Topo do site (abaixo do menu)', tipos: ['aviso', 'card'] },
  { id: 'pagina-topo', nome: 'Começo do conteúdo da página', tipos: ['aviso', 'card'] },
  { id: 'home-apos-hero', nome: 'Início: depois do título principal', tipos: ['aviso', 'card'] },
  { id: 'home-apos-recursos', nome: 'Início: depois dos cartões de recursos', tipos: ['aviso', 'card'] },
  { id: 'home-antes-avaliacoes', nome: 'Início: antes das avaliações', tipos: ['aviso', 'card'] },
  { id: 'home-antes-planos', nome: 'Início: antes dos planos', tipos: ['aviso', 'card'] },
  { id: 'pagina-fim', nome: 'Fim do conteúdo da página', tipos: ['aviso', 'card'] },
  { id: 'lateral-esquerda', nome: 'Lateral esquerda (vira bloco no celular)', tipos: ['card', 'aviso'] },
  { id: 'lateral-direita', nome: 'Lateral direita (vira bloco no celular)', tipos: ['card', 'aviso'] },
  { id: 'rodape', nome: 'Acima do rodapé (todas as páginas)', tipos: ['aviso', 'card'] }
];
export const PAGINAS = [
  { id: 'todas', nome: 'Todas as páginas' },
  { id: 'home', nome: 'Página inicial' },
  { id: 'planos', nome: 'Planos' },
  { id: 'avaliacoes', nome: 'Avaliações' },
  { id: 'ajuda', nome: 'Ajuda e extensão' },
  { id: 'dashboard', nome: 'Painel do usuário' },
  { id: 'canal', nome: 'Meu canal' },
  { id: 'ferramentas', nome: 'Ferramentas' }
];
const ESTILOS = ['info', 'aviso', 'ok', 'destaque'];
const TIPOS = ['aviso', 'card'];
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const umDe = (v, lista, nome) => {
  const t = String(v ?? '').trim();
  if (!lista.includes(t)) throw new HttpError(400, `${nome} inválido.`);
  return t;
};
const texto = (v, max, nome) => {
  const t = String(v ?? '').trim();
  if (t.length > max) throw new HttpError(400, `${nome} pode ter no máximo ${max} caracteres.`);
  return t;
};
/** Só http e https. Barra javascript:, data: e endereço quebrado. */
function url(v, nome) {
  const t = String(v ?? '').trim();
  if (!t) return '';
  let u;
  try { u = new URL(t); } catch { throw new HttpError(400, `${nome} não é um endereço válido (comece com https://).`); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, `${nome} precisa começar com http:// ou https://.`);
  if (u.href.length > 600) throw new HttpError(400, `${nome} é longo demais.`);
  return u.href;
}

function lerBloco(body) {
  const tipo = umDe(body?.tipo, TIPOS, 'Tipo');
  const b = {
    tipo,
    pagina: umDe(body?.pagina, PAGINAS.map((p) => p.id), 'Página'),
    slot: umDe(body?.slot, SLOTS.map((s) => s.id), 'Posição'),
    titulo: texto(body?.titulo, 120, 'O título'),
    texto: texto(body?.texto, 600, 'O texto'),
    emoji: texto(body?.emoji, 8, 'O emoji'),
    imagem_url: url(body?.imagem_url, 'O endereço da imagem'),
    link_url: url(body?.link_url, 'O link'),
    link_texto: texto(body?.link_texto, 40, 'O texto do botão'),
    mostrar_url: body?.mostrar_url ? 1 : 0,
    estilo: umDe(body?.estilo || 'info', ESTILOS, 'Estilo'),
    publicado: body?.publicado === false || body?.publicado === 0 ? 0 : 1
  };
  if (!b.titulo && !b.texto) throw new HttpError(400, 'Escreva ao menos um título ou um texto.');
  if (tipo === 'card' && !b.titulo) throw new HttpError(400, 'O card precisa de um nome (título).');
  if (tipo === 'card' && !b.link_url && !b.texto) throw new HttpError(400, 'O card precisa de um link ou de um texto.');
  return b;
}

const publico = (r) => ({
  id: r.id, tipo: r.tipo, pagina: r.pagina, slot: r.slot, ordem: Number(r.ordem),
  titulo: r.titulo, texto: r.texto, emoji: r.emoji,
  imagem_url: r.imagem_url, link_url: r.link_url, link_texto: r.link_texto,
  mostrar_url: !!Number(r.mostrar_url), estilo: r.estilo, publicado: !!Number(r.publicado),
  criado_em: r.created_at, editado_em: r.updated_at
});

export function blockRoutes(app, db, auth) {
  // ---------- o que o visitante vê ----------
  app.get('/api/blocks', wrap(async (req, res) => {
    const pagina = String(req.query.pagina || 'home').trim().slice(0, 40);
    const linhas = await db.all(
      'SELECT * FROM blocos WHERE publicado=1 AND (pagina=? OR pagina=?) ORDER BY slot, ordem, created_at',
      [pagina, 'todas']
    );
    res.json({ itens: linhas.map(publico) });
  }));

  // ---------- painel ----------
  app.get('/api/admin/blocks', ...auth.admin, wrap(async (req, res) => {
    const linhas = await db.all('SELECT * FROM blocos ORDER BY pagina, slot, ordem, created_at');
    res.json({ itens: linhas.map(publico), slots: SLOTS, paginas: PAGINAS, estilos: ESTILOS });
  }));

  app.post('/api/admin/blocks', ...auth.admin, wrap(async (req, res) => {
    const b = lerBloco(req.body);
    const ultimo = await db.get('SELECT MAX(ordem) AS m FROM blocos WHERE pagina=? AND slot=?', [b.pagina, b.slot]);
    const id = uid();
    await db.run(
      `INSERT INTO blocos(id,tipo,pagina,slot,ordem,titulo,texto,emoji,imagem_url,link_url,link_texto,mostrar_url,estilo,publicado,criado_por,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, b.tipo, b.pagina, b.slot, Number(ultimo?.m ?? -1) + 1, b.titulo, b.texto, b.emoji, b.imagem_url, b.link_url, b.link_texto, b.mostrar_url, b.estilo, b.publicado, req.user.id, now(), now()]
    );
    await db.run('INSERT INTO audit(id, actor_id, actor_email, action, target, detail, created_at) VALUES(?,?,?,?,?,?,?)',
      [uid(), req.user.id, req.user.email, 'bloco.criar', id, `${b.tipo} em ${b.pagina}/${b.slot}: ${b.titulo}`, now()]);
    res.json({ ok: true, bloco: publico(await db.get('SELECT * FROM blocos WHERE id=?', [id])) });
  }));

  app.put('/api/admin/blocks/:id', ...auth.admin, wrap(async (req, res) => {
    const atual = await db.get('SELECT * FROM blocos WHERE id=?', [req.params.id]);
    if (!atual) throw new HttpError(404, 'Aviso ou card não encontrado.');
    const b = lerBloco({ ...publico(atual), ...req.body });
    const mudouLugar = b.pagina !== atual.pagina || b.slot !== atual.slot;
    let ordem = Number(atual.ordem);
    if (mudouLugar) {
      const ultimo = await db.get('SELECT MAX(ordem) AS m FROM blocos WHERE pagina=? AND slot=?', [b.pagina, b.slot]);
      ordem = Number(ultimo?.m ?? -1) + 1;
    }
    await db.run(
      `UPDATE blocos SET tipo=?,pagina=?,slot=?,ordem=?,titulo=?,texto=?,emoji=?,imagem_url=?,link_url=?,link_texto=?,mostrar_url=?,estilo=?,publicado=?,updated_at=? WHERE id=?`,
      [b.tipo, b.pagina, b.slot, ordem, b.titulo, b.texto, b.emoji, b.imagem_url, b.link_url, b.link_texto, b.mostrar_url, b.estilo, b.publicado, now(), atual.id]
    );
    await db.run('INSERT INTO audit(id, actor_id, actor_email, action, target, detail, created_at) VALUES(?,?,?,?,?,?,?)',
      [uid(), req.user.id, req.user.email, 'bloco.editar', atual.id, `${b.tipo} em ${b.pagina}/${b.slot}`, now()]);
    res.json({ ok: true, bloco: publico(await db.get('SELECT * FROM blocos WHERE id=?', [atual.id])) });
  }));

  app.delete('/api/admin/blocks/:id', ...auth.admin, wrap(async (req, res) => {
    const atual = await db.get('SELECT * FROM blocos WHERE id=?', [req.params.id]);
    if (!atual) throw new HttpError(404, 'Aviso ou card não encontrado.');
    await db.run('DELETE FROM blocos WHERE id=?', [atual.id]);
    await db.run('INSERT INTO audit(id, actor_id, actor_email, action, target, detail, created_at) VALUES(?,?,?,?,?,?,?)',
      [uid(), req.user.id, req.user.email, 'bloco.excluir', atual.id, `${atual.tipo}: ${atual.titulo}`, now()]);
    res.json({ ok: true });
  }));

  // sobe ou desce um lugar dentro da mesma posição (troca a ordem com o vizinho)
  app.post('/api/admin/blocks/:id/move', ...auth.admin, wrap(async (req, res) => {
    const direcao = umDe(req.body?.direcao, ['cima', 'baixo'], 'Direção');
    const atual = await db.get('SELECT * FROM blocos WHERE id=?', [req.params.id]);
    if (!atual) throw new HttpError(404, 'Aviso ou card não encontrado.');
    const vizinho = await db.get(
      direcao === 'cima'
        ? 'SELECT * FROM blocos WHERE pagina=? AND slot=? AND ordem<? ORDER BY ordem DESC LIMIT 1'
        : 'SELECT * FROM blocos WHERE pagina=? AND slot=? AND ordem>? ORDER BY ordem ASC LIMIT 1',
      [atual.pagina, atual.slot, Number(atual.ordem)]
    );
    if (!vizinho) return res.json({ ok: true, semMudanca: true });
    await db.run('UPDATE blocos SET ordem=?, updated_at=? WHERE id=?', [Number(vizinho.ordem), now(), atual.id]);
    await db.run('UPDATE blocos SET ordem=?, updated_at=? WHERE id=?', [Number(atual.ordem), now(), vizinho.id]);
    res.json({ ok: true });
  }));
}
