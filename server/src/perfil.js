// Foto de perfil.
//
// A imagem chega já reduzida e recortada quadrada pelo navegador (256x256) e
// fica guardada como texto no próprio banco. Não uso disco porque o disco da
// hospedagem é efêmero: a foto sumiria no deploy seguinte, e foto que some
// sozinha é pior que foto que nunca existiu.
//
// Sem foto, a pessoa fica com a inicial do nome sobre uma cor fixa, igual ao
// YouTube. A cor sai do id, então é sempre a mesma para a mesma pessoa.

import { HttpError, now, audit } from './util.js';

export const MAX_BYTES = 180 * 1024;          // ~180 KB depois do recorte
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];

/** Confere que o que chegou é mesmo imagem, e pequena. */
export function validarFoto(dataUrl) {
  const txt = String(dataUrl || '');
  const m = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(txt);
  if (!m) throw new HttpError(400, 'Formato de imagem não reconhecido.');
  const [, tipo, b64] = m;
  if (!TIPOS.includes(tipo.toLowerCase())) throw new HttpError(400, 'Use uma imagem JPG, PNG ou WebP.');
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > MAX_BYTES) throw new HttpError(413, `Imagem grande demais (${Math.round(bytes / 1024)} KB). O limite é ${Math.round(MAX_BYTES / 1024)} KB depois do recorte.`);
  // Piso baixo de propósito: serve só para recusar payload vazio ou lixo.
  // Foto de verdade tem dezenas de KB; não cabe a mim exigir tamanho mínimo.
  if (bytes < 60) throw new HttpError(400, 'Imagem vazia.');
  return { tipo, bytes, dataUrl: txt };
}

/** Cor fixa a partir do id: a mesma pessoa tem sempre a mesma cor. */
export function corDoId(id) {
  const cores = ['#e8554e', '#e8824e', '#d9a441', '#5fa85f', '#3f9b9b', '#4a79c9', '#7a5fc9', '#b85fa8', '#9b6b4a', '#5f6b7a'];
  let h = 0;
  for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) % 100000;
  return cores[h % cores.length];
}

export function inicialDe(nome, email) {
  const base = String(nome || email || '?').trim();
  const letra = base.replace(/[^\p{L}\p{N}]/gu, '').charAt(0);
  return (letra || '?').toUpperCase();
}

export function perfilRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  app.post('/api/me/foto', auth.required, wrap(async (req, res) => {
    const { dataUrl, bytes } = validarFoto(req.body?.imagem);
    await db.run('UPDATE users SET foto_url=? WHERE id=?', [dataUrl, req.user.id]);
    await audit(db, req.user, 'perfil.foto', req.user.id, `${Math.round(bytes / 1024)} KB`);
    res.json({ ok: true, foto: dataUrl });
  }));

  app.delete('/api/me/foto', auth.required, wrap(async (req, res) => {
    await db.run('UPDATE users SET foto_url=NULL WHERE id=?', [req.user.id]);
    await audit(db, req.user, 'perfil.foto_removida', req.user.id, '');
    res.json({ ok: true });
  }));

  // Só o que é público de um perfil: nome, inicial, cor e foto. Nunca e-mail.
  app.get('/api/perfil/:id', auth.required, wrap(async (req, res) => {
    const u = await db.get('SELECT id, name, email, role, foto_url FROM users WHERE id=?', [req.params.id]);
    if (!u) throw new HttpError(404, 'Pessoa não encontrada.');
    res.json({
      id: u.id,
      nome: u.name || 'Alguém',
      papel: u.role === 'owner' ? 'dono' : u.role === 'admin' ? 'equipe' : '',
      foto: u.foto_url || null,
      inicial: inicialDe(u.name, u.email),
      cor: corDoId(u.id)
    });
  }));
}
