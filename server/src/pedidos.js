// Aprovação do administrador principal.
//
// Pedido do dono: administrador comum NÃO executa sozinho nada que mexa na conta
// de outra pessoa. A ação vira um PEDIDO que chega ao administrador principal
// com Sim / Não / Conversar. O pedido guarda exatamente o que será feito, e a
// execução só acontece depois do Sim, no servidor, nunca no navegador.
//
// Isso é o que segura o estrago se uma conta de administrador for invadida:
// quem entrar numa conta de admin comum consegue PEDIR, não consegue FAZER.

import { HttpError, uid, now, audit } from './util.js';
import { grant } from './credits.js';
import { notificar, notificarDono } from './notify.js';

const txt = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const n = (v) => Number(v || 0).toLocaleString('pt-BR');

async function usuario(db, id) {
  const u = await db.get('SELECT id,email,name,role,plan_id,credits,banido FROM users WHERE id=?', [id]);
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  return u;
}

/** Cada ação sabe se descrever e se executar. Ação fora desta lista não existe. */
export const ACOES = {
  creditos: {
    rotulo: 'Ajustar créditos',
    async validar(db, dados) {
      const delta = parseInt(dados.delta, 10);
      if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000000) throw new HttpError(400, 'Informe um ajuste de créditos válido (inteiro diferente de zero).');
      const alvo = await usuario(db, dados.alvo_user);
      if (alvo.role === 'owner') throw new HttpError(403, 'O administrador principal tem créditos ilimitados; não há o que ajustar.');
      return { delta, motivo: txt(dados.motivo) || 'Ajuste manual pelo administrador' };
    },
    descrever: (p, alvo) => `${p.payload.delta >= 0 ? 'aumentar' : 'diminuir'} ${n(Math.abs(p.payload.delta))} créditos de ${alvo}`,
    async executar(db, p, quem) {
      const bal = await grant(db, p.alvo_user, p.payload.delta, p.payload.motivo);
      await notificar(db, p.alvo_user, p.payload.delta >= 0 ? 'creditos_aumentados' : 'creditos_diminuidos',
        p.payload.delta >= 0 ? `Você recebeu ${n(p.payload.delta)} créditos` : `Foram retirados ${n(-p.payload.delta)} créditos`,
        { corpo: `Motivo: ${p.payload.motivo}.`, link: '#/historico', dados: { delta: p.payload.delta } });
      await audit(db, quem, 'admin.credits_adjust', p.alvo_user, `${p.payload.delta >= 0 ? '+' : ''}${p.payload.delta} (${p.payload.motivo})`);
      return { balance: bal };
    }
  },

  banir: {
    rotulo: 'Banir conta',
    async validar(db, dados) {
      const alvo = await usuario(db, dados.alvo_user);
      // Banir só vale para conta comum. Administrador se tira do cargo pela aba
      // Administradores; banir um deles seria um admin derrubando o outro.
      if (alvo.role !== 'user') throw new HttpError(403, 'Conta de administrador não é banida. Para tirar o acesso, remova o cargo na aba Administradores.');
      if (alvo.banido) throw new HttpError(409, 'Essa conta já está banida.');
      return { motivo: txt(dados.motivo) || 'Não informado' };
    },
    descrever: (p, alvo) => `banir a conta ${alvo}`,
    async executar(db, p, quem) {
      await db.run('UPDATE users SET banido=1, banido_motivo=? WHERE id=?', [p.payload.motivo, p.alvo_user]);
      await audit(db, quem, 'admin.ban', p.alvo_user, p.payload.motivo);
      return { banido: true };
    }
  },

  desbanir: {
    rotulo: 'Tirar o banimento',
    async validar(db, dados) {
      const alvo = await usuario(db, dados.alvo_user);
      if (alvo.role !== 'user') throw new HttpError(403, 'Conta de administrador não entra nessa lista.');
      if (!alvo.banido) throw new HttpError(409, 'Essa conta não está banida.');
      return { motivo: txt(dados.motivo) };
    },
    descrever: (p, alvo) => `tirar o banimento de ${alvo}`,
    async executar(db, p, quem) {
      await db.run("UPDATE users SET banido=0, banido_motivo='' WHERE id=?", [p.alvo_user]);
      await audit(db, quem, 'admin.unban', p.alvo_user, p.payload.motivo || '');
      return { banido: false };
    }
  },

  remover_comentario: {
    rotulo: 'Remover comentário',
    async validar(db, dados) {
      const tipo = ['avaliacao', 'comentario', 'resposta'].includes(dados.alvo_tipo) ? dados.alvo_tipo : null;
      if (!tipo) throw new HttpError(400, 'Tipo de conteúdo inválido.');
      const tabela = { avaliacao: 'reviews', comentario: 'site_comments', resposta: 'respostas' }[tipo];
      const alvo = await db.get(`SELECT id FROM ${tabela} WHERE id=?`, [dados.alvo_id]);
      if (!alvo) throw new HttpError(404, 'Conteúdo não encontrado.');
      return { alvo_tipo: tipo, motivo: txt(dados.motivo) || 'Moderação' };
    },
    descrever: (p) => `remover ${{ avaliacao: 'uma avaliação', comentario: 'um comentário', resposta: 'uma resposta' }[p.payload.alvo_tipo]}`,
    async executar(db, p, quem) {
      // Mesma escrita que a moderação direta do dono usa: sem isso o caminho da
      // fila deixava a denúncia em aberto e não gravava quem moderou.
      const { aplicarModeracao } = await import('./reviews.js');
      await aplicarModeracao(db, quem, p.payload.alvo_tipo, p.alvo_id, true, p.payload.motivo);
      await audit(db, quem, 'moderacao.remover', p.alvo_id, `${p.payload.alvo_tipo} · ${p.payload.motivo}`);
      return { removido: true };
    }
  },

  adicionar_admin: {
    rotulo: 'Adicionar administrador',
    async validar(db, dados) {
      const email = txt(dados.email, 190).toLowerCase();
      const alvo = await db.get('SELECT * FROM users WHERE email=?', [email]);
      if (!alvo) throw new HttpError(404, 'Não existe conta cadastrada com esse e-mail.');
      if (alvo.role === 'owner') throw new HttpError(400, 'Essa conta já é o administrador principal.');
      if (alvo.role === 'admin') throw new HttpError(409, 'Essa conta já é administradora.');
      return { email, alvo_user: alvo.id };
    },
    descrever: (p) => `tornar ${p.payload.email} administrador`,
    async executar(db, p, quem) {
      await db.run("UPDATE users SET role='admin' WHERE id=?", [p.payload.alvo_user]);
      await notificar(db, p.payload.alvo_user, 'virou_admin', 'Você agora é administrador do TurboCanal', {
        corpo: 'Você já pode abrir o painel. Ações que mexem na conta dos outros passam pela aprovação do administrador principal.',
        link: '#/admin'
      });
      await audit(db, quem, 'admin.promote', p.payload.email);
      return { promovido: true };
    }
  },

  remover_admin: {
    rotulo: 'Remover administrador',
    async validar(db, dados) {
      const alvo = await usuario(db, dados.alvo_user);
      if (alvo.role === 'owner') throw new HttpError(403, 'O administrador principal não pode ser rebaixado.');
      if (alvo.role !== 'admin') throw new HttpError(400, 'Essa conta não é administradora.');
      return { email: alvo.email };
    },
    descrever: (p, alvo) => `tirar o acesso de administrador de ${alvo}`,
    async executar(db, p, quem) {
      await db.run("UPDATE users SET role='user' WHERE id=?", [p.alvo_user]);
      await notificar(db, p.alvo_user, 'deixou_admin', 'Seu acesso de administrador foi removido', {
        corpo: 'Sua conta continua normal, só não abre mais o painel administrativo.', link: '#/dashboard'
      });
      await audit(db, quem, 'admin.demote', p.payload.email);
      return { removido: true };
    }
  },

  criar_grupo: {
    rotulo: 'Criar grupo de conversa',
    async validar(db, dados) {
      const nome = txt(dados.nome, 60);
      if (!nome) throw new HttpError(400, 'Dê um nome ao grupo.');
      const ids = Array.isArray(dados.membros) ? [...new Set(dados.membros.map((x) => String(x)))].slice(0, 20) : [];
      if (!ids.length) throw new HttpError(400, 'Escolha pelo menos uma pessoa para o grupo.');
      const rows = await db.all(`SELECT id,email,role FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      if (rows.length !== ids.length) throw new HttpError(400, 'Alguma das contas escolhidas não existe.');
      if (rows.some((r) => !['owner', 'admin'].includes(r.role))) throw new HttpError(400, 'O chat é só entre administradores.');
      return { nome, membros: ids, emails: rows.map((r) => r.email) };
    },
    descrever: (p) => `criar o grupo "${p.payload.nome}" com ${p.payload.emails.join(' + ')}`,
    async executar(db, p, quem) {
      const { criarGrupo } = await import('./chat.js');
      const conv = await criarGrupo(db, p.pedido_por, p.payload.nome, p.payload.membros);
      await audit(db, quem, 'chat.grupo_criado', conv.id, p.payload.nome);
      return { conversa: conv.id };
    }
  },

  // ---------- Dinheiro e preços ----------

  confirmar_pagamento: {
    rotulo: 'Confirmar pagamento à mão',
    async validar(db, dados) {
      const p = await db.get('SELECT * FROM payments WHERE id=?', [dados.alvo_id]);
      if (!p) throw new HttpError(404, 'Pagamento não encontrado.');
      if (p.status === 'approved') throw new HttpError(409, 'Esse pagamento já foi aprovado.');
      const note = txt(dados.note, 300);
      if (!note) throw new HttpError(400, 'Descreva como você conferiu o recebimento (ex.: comprovante Pix, extrato).');
      const dono = await db.get('SELECT email FROM users WHERE id=?', [p.user_id]);
      return { pagamento: p.id, note, valor: Number(p.amount_cents), plano: p.plan_id, email: dono?.email || '' };
    },
    descrever: (p) => `confirmar à mão o pagamento de R$ ${(Number(p.payload.valor) / 100).toFixed(2).replace('.', ',')} do plano ${p.payload.plano} de ${p.payload.email} (conferiu por: ${p.payload.note})`,
    async executar(db, p, quem) {
      const pag = await db.get('SELECT * FROM payments WHERE id=?', [p.payload.pagamento]);
      if (!pag) throw new HttpError(404, 'Pagamento não encontrado.');
      if (pag.status === 'approved') return { ja_aprovado: true };
      const { activatePayment } = await import('./payments.js');
      const upd = await activatePayment(db, pag, quem, `confirmação manual do administrador: ${p.payload.note}`);
      return { status: upd.status };
    }
  },

  criar_plano: {
    rotulo: 'Criar plano',
    async validar(db, dados) {
      const id = txt(dados.id, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!id) throw new HttpError(400, 'ID de plano inválido.');
      if (await db.get('SELECT 1 AS x FROM plans WHERE id=?', [id])) throw new HttpError(409, 'Já existe um plano com esse ID.');
      const name = txt(dados.name, 60);
      if (!name) throw new HttpError(400, 'Dê um nome ao plano.');
      const price = parseInt(dados.price_cents, 10);
      const credits = parseInt(dados.monthly_credits, 10);
      if (!Number.isInteger(price) || price < 0) throw new HttpError(400, 'Preço inválido.');
      if (!Number.isInteger(credits) || credits <= 0) throw new HttpError(400, 'Créditos mensais inválidos.');
      return { id, name, price, credits, sort: parseInt(dados.sort, 10) || 99, description: txt(dados.description, 400) };
    },
    descrever: (p) => `criar o plano "${p.payload.name}" a R$ ${(p.payload.price / 100).toFixed(2).replace('.', ',')} com ${n(p.payload.credits)} créditos por mês`,
    async executar(db, p, quem) {
      const v = p.payload;
      await db.run('INSERT INTO plans(id,name,price_cents,monthly_credits,sort,active,description) VALUES(?,?,?,?,?,?,?)',
        [v.id, v.name, v.price, v.credits, v.sort, 1, v.description]);
      await audit(db, quem, 'admin.plan_create', v.id, `${v.name} R$${(v.price / 100).toFixed(2)} ${v.credits}cr`);
      return { plano: v.id };
    }
  },

  editar_plano: {
    rotulo: 'Editar plano',
    async validar(db, dados) {
      const plan = await db.get('SELECT * FROM plans WHERE id=?', [dados.alvo_id]);
      if (!plan) throw new HttpError(404, 'Plano não encontrado.');
      const name = dados.name !== undefined ? txt(dados.name, 60) : plan.name;
      const price = dados.price_cents !== undefined ? parseInt(dados.price_cents, 10) : Number(plan.price_cents);
      const credits = dados.monthly_credits !== undefined ? parseInt(dados.monthly_credits, 10) : Number(plan.monthly_credits);
      const active = dados.active !== undefined ? (dados.active ? 1 : 0) : Number(plan.active);
      const sort = dados.sort !== undefined ? parseInt(dados.sort, 10) || 0 : Number(plan.sort);
      const description = dados.description !== undefined ? txt(dados.description, 400) : plan.description;
      if (!name) throw new HttpError(400, 'O plano precisa de um nome.');
      if (!Number.isInteger(price) || price < 0) throw new HttpError(400, 'Preço inválido.');
      if (!Number.isInteger(credits) || credits <= 0) throw new HttpError(400, 'Créditos mensais inválidos.');
      if (plan.id === 'free' && price > 0) throw new HttpError(400, 'O plano Free precisa continuar com preço zero.');
      return { plano: plan.id, name, price, credits, active, sort, description, antes: { name: plan.name, price: Number(plan.price_cents), credits: Number(plan.monthly_credits), active: Number(plan.active) } };
    },
    descrever: (p) => {
      const v = p.payload, a = v.antes, m = [];
      if (a.name !== v.name) m.push(`nome "${a.name}" → "${v.name}"`);
      if (a.price !== v.price) m.push(`preço R$ ${(a.price / 100).toFixed(2).replace('.', ',')} → R$ ${(v.price / 100).toFixed(2).replace('.', ',')}`);
      if (a.credits !== v.credits) m.push(`créditos mensais ${n(a.credits)} → ${n(v.credits)}`);
      if (a.active !== v.active) m.push(v.active ? 'reativar o plano' : 'desativar o plano');
      return `mudar o plano ${v.plano}: ${m.length ? m.join(', ') : 'ajustes de ordem ou descrição'}`;
    },
    async executar(db, p, quem) {
      const v = p.payload;
      await db.run('UPDATE plans SET name=?,price_cents=?,monthly_credits=?,active=?,sort=?,description=? WHERE id=?',
        [v.name, v.price, v.credits, v.active, v.sort, v.description, v.plano]);
      await audit(db, quem, 'admin.plan_update', v.plano, `R$${(v.price / 100).toFixed(2)} ${v.credits}cr ativo=${v.active}`);
      return { plano: v.plano };
    }
  },

  custo_ferramenta: {
    rotulo: 'Mudar o preço de uma ferramenta',
    async validar(db, dados) {
      const row = await db.get('SELECT * FROM tool_costs WHERE tool=?', [dados.alvo_id]);
      if (!row) throw new HttpError(404, 'Ferramenta não encontrada.');
      const cost = parseInt(dados.cost, 10);
      if (!Number.isInteger(cost) || cost < 0 || cost > 100000) throw new HttpError(400, 'Custo inválido.');
      return { tool: row.tool, rotulo: row.label || row.tool, cost, antes: Number(row.cost) };
    },
    descrever: (p) => `mudar o preço de "${p.payload.rotulo}" de ${n(p.payload.antes)} para ${n(p.payload.cost)} créditos`,
    async executar(db, p, quem) {
      await db.run('UPDATE tool_costs SET cost=? WHERE tool=?', [p.payload.cost, p.payload.tool]);
      await audit(db, quem, 'admin.tool_cost', p.payload.tool, String(p.payload.cost));
      return { tool: p.payload.tool, cost: p.payload.cost };
    }
  },

  plano_do_usuario: {
    rotulo: 'Trocar o plano de um usuário',
    async validar(db, dados) {
      const plano = await db.get('SELECT id,name,monthly_credits FROM plans WHERE id=?', [txt(dados.plan_id, 40)]);
      if (!plano) throw new HttpError(404, 'Plano não encontrado.');
      const alvo = await usuario(db, dados.alvo_user);
      if (alvo.plan_id === plano.id) throw new HttpError(409, 'Essa conta já está nesse plano.');
      return { plan_id: plano.id, plano: plano.name, creditos: Number(plano.monthly_credits), antes: alvo.plan_id };
    },
    descrever: (p, alvo) => `trocar o plano de ${alvo} de ${p.payload.antes} para ${p.payload.plano} (${n(p.payload.creditos)} créditos por mês)`,
    async executar(db, p, quem) {
      await db.run('UPDATE users SET plan_id=? WHERE id=?', [p.payload.plan_id, p.alvo_user]);
      const alvo = await db.get('SELECT email FROM users WHERE id=?', [p.alvo_user]);
      await audit(db, quem, 'admin.user_plan_set', alvo?.email || p.alvo_user, p.payload.plan_id);
      return { plan_id: p.payload.plan_id };
    }
  },

  // ---------- Avisos e cards (o que aparece no site público) ----------

  bloco_criar: {
    rotulo: 'Criar aviso ou card',
    async validar(db, dados) {
      const { lerBloco } = await import('./blocks.js');
      return { bloco: lerBloco(dados.bloco || {}) };
    },
    descrever: (p) => `criar o ${p.payload.bloco.tipo} "${p.payload.bloco.titulo || '(sem título)'}" em ${p.payload.bloco.pagina}/${p.payload.bloco.slot}`,
    async executar(db, p, quem) {
      const { criarBloco } = await import('./blocks.js');
      return { bloco: await criarBloco(db, quem, p.payload.bloco) };
    }
  },

  bloco_editar: {
    rotulo: 'Editar aviso ou card',
    async validar(db, dados) {
      const atual = await db.get('SELECT * FROM blocos WHERE id=?', [dados.alvo_id]);
      if (!atual) throw new HttpError(404, 'Aviso ou card não encontrado.');
      const { lerBloco, publicoBloco } = await import('./blocks.js');
      return { id: atual.id, antes: atual.titulo, bloco: lerBloco({ ...publicoBloco(atual), ...(dados.bloco || {}) }) };
    },
    descrever: (p) => `editar o ${p.payload.bloco.tipo} "${p.payload.antes || '(sem título)'}" (fica em ${p.payload.bloco.pagina}/${p.payload.bloco.slot})`,
    async executar(db, p, quem) {
      const { editarBloco } = await import('./blocks.js');
      return { bloco: await editarBloco(db, quem, p.payload.id, p.payload.bloco) };
    }
  },

  bloco_excluir: {
    rotulo: 'Excluir aviso ou card',
    async validar(db, dados) {
      const atual = await db.get('SELECT * FROM blocos WHERE id=?', [dados.alvo_id]);
      if (!atual) throw new HttpError(404, 'Aviso ou card não encontrado.');
      return { id: atual.id, tipo: atual.tipo, titulo: atual.titulo, onde: `${atual.pagina}/${atual.slot}` };
    },
    descrever: (p) => `excluir o ${p.payload.tipo} "${p.payload.titulo || '(sem título)'}" de ${p.payload.onde}`,
    async executar(db, p, quem) {
      const { excluirBloco } = await import('./blocks.js');
      await excluirBloco(db, quem, p.payload.id);
      return { excluido: true };
    }
  },

  bloco_mover: {
    rotulo: 'Mudar a ordem de um aviso ou card',
    async validar(db, dados) {
      const atual = await db.get('SELECT * FROM blocos WHERE id=?', [dados.alvo_id]);
      if (!atual) throw new HttpError(404, 'Aviso ou card não encontrado.');
      const direcao = txt(dados.direcao, 10);
      if (!['cima', 'baixo'].includes(direcao)) throw new HttpError(400, 'Direção inválida.');
      return { id: atual.id, direcao, titulo: atual.titulo, onde: `${atual.pagina}/${atual.slot}` };
    },
    descrever: (p) => `mover "${p.payload.titulo || '(sem título)'}" para ${p.payload.direcao} em ${p.payload.onde}`,
    async executar(db, p, quem) {
      const { moverBloco } = await import('./blocks.js');
      return await moverBloco(db, quem, p.payload.id, p.payload.direcao);
    }
  },

  criar_postagem: {
    rotulo: 'Publicar postagem',
    async validar(db, dados) {
      const { lerArea } = await import('./postagens.js');
      return { area: lerArea(dados.area), titulo: txt(dados.titulo, 140), texto: txt(dados.texto, 6000), imagem: dados.imagem || null };
    },
    descrever: (p) => `publicar "${p.payload.titulo}" na área ${p.payload.area === 'admin' ? 'dos administradores' : 'pública'}${p.payload.imagem ? ' (com imagem)' : ''}`,
    async executar(db, p, quem) {
      const { criarPostagem } = await import('./postagens.js');
      return criarPostagem(db, quem, p.payload);
    }
  },

  editar_postagem: {
    rotulo: 'Editar postagem',
    async validar(db, dados) {
      const atual = await db.get('SELECT id, titulo FROM postagens WHERE id=? AND status=?', [dados.alvo_id, 'ativa']);
      if (!atual) throw new HttpError(404, 'Postagem não encontrada.');
      return { id: atual.id, antes: atual.titulo, titulo: txt(dados.titulo, 140), texto: txt(dados.texto, 6000), imagem: dados.imagem || null, trocarImagem: !!dados.trocarImagem };
    },
    descrever: (p) => `editar a postagem "${p.payload.antes}"`,
    async executar(db, p, quem) {
      const { editarPostagem } = await import('./postagens.js');
      return editarPostagem(db, quem, p.payload.id, p.payload);
    }
  },

  excluir_postagem: {
    rotulo: 'Excluir postagem',
    async validar(db, dados) {
      const atual = await db.get('SELECT id, titulo, area FROM postagens WHERE id=? AND status=?', [dados.alvo_id, 'ativa']);
      if (!atual) throw new HttpError(404, 'Postagem não encontrada.');
      return { id: atual.id, titulo: atual.titulo, area: atual.area, motivo: txt(dados.motivo) };
    },
    descrever: (p) => `excluir a postagem "${p.payload.titulo}"`,
    async executar(db, p, quem) {
      const { excluirPostagem } = await import('./postagens.js');
      return excluirPostagem(db, quem, p.payload.id, p.payload.motivo);
    }
  },

  apagar_comentario_postagem: {
    rotulo: 'Apagar comentário de postagem',
    async validar(db, dados) {
      const c = await db.get('SELECT id, user_id FROM post_comentarios WHERE id=? AND status=?', [dados.alvo_id, 'ativo']);
      if (!c) throw new HttpError(404, 'Comentário não encontrado.');
      const autor = await db.get('SELECT email FROM users WHERE id=?', [c.user_id]);
      return { id: c.id, autor: autor?.email || '', motivo: txt(dados.motivo) || 'Moderação' };
    },
    descrever: (p) => `apagar um comentário de ${p.payload.autor} numa postagem`,
    async executar(db, p, quem) {
      const { apagarComentarioPostagem } = await import('./postagens.js');
      return apagarComentarioPostagem(db, quem, p.payload.id, p.payload.motivo);
    }
  },

  apagar_mensagem_publica: {
    rotulo: 'Apagar mensagem do bate-papo',
    async validar(db, dados) {
      const m = await db.get('SELECT id, user_id FROM chat_publico WHERE id=? AND status=?', [dados.alvo_id, 'ativo']);
      if (!m) throw new HttpError(404, 'Mensagem não encontrada.');
      const autor = await db.get('SELECT email FROM users WHERE id=?', [m.user_id]);
      return { mensagem: m.id, autor: autor?.email || '', motivo: txt(dados.motivo) || 'Moderação' };
    },
    descrever: (p) => `apagar uma mensagem de ${p.payload.autor} no bate-papo público`,
    async executar(db, p, quem) {
      const { apagarMensagemPublica } = await import('./publico.js');
      return apagarMensagemPublica(db, quem, p.payload.mensagem, p.payload.motivo);
    }
  },

  restaurar_comentario: {
    rotulo: 'Restaurar comentário removido',
    async validar(db, dados) {
      const { TIPOS_MOD } = await import('./reviews.js');
      const tipo = String(dados.alvo_tipo || '');
      if (!TIPOS_MOD[tipo]) throw new HttpError(400, 'Tipo de conteúdo inválido.');
      const alvo = await db.get(`SELECT * FROM ${TIPOS_MOD[tipo]} WHERE id=?`, [dados.alvo_id]);
      if (!alvo) throw new HttpError(404, 'Conteúdo não encontrado.');
      return { alvo_tipo: tipo, alvo_id: alvo.id, motivo: txt(dados.motivo, 300) };
    },
    descrever: (p) => `restaurar um ${p.payload.alvo_tipo} que estava removido`,
    async executar(db, p, quem) {
      const { aplicarModeracao } = await import('./reviews.js');
      await aplicarModeracao(db, quem, p.payload.alvo_tipo, p.payload.alvo_id, false, p.payload.motivo);
      return { restaurado: true };
    }
  }
};

/** O caminho único de toda ação administrativa sensível.
 *  Dono executa na hora. Admin comum cria um pedido e o dono decide. */
export async function pedirOuFazer(db, user, acao, dados = {}) {
  const def = ACOES[acao];
  if (!def) throw new HttpError(400, 'Ação administrativa desconhecida.');
  if (!['owner', 'admin'].includes(user.role)) throw new HttpError(403, 'Só administradores.');
  const payload = await def.validar(db, dados);
  const alvoUser = dados.alvo_user || payload.alvo_user || null;
  const alvoId = dados.alvo_id || null;

  if (user.role === 'owner') {
    const p = { id: uid(), acao, pedido_por: user.id, alvo_user: alvoUser, alvo_id: alvoId, payload };
    const resultado = await def.executar(db, p, user);
    return { executado: true, resultado };
  }

  const id = uid();
  await db.run(
    'INSERT INTO pedidos_admin(id,acao,pedido_por,alvo_user,alvo_id,payload,motivo,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [id, acao, user.id, alvoUser, alvoId, JSON.stringify(payload), txt(dados.motivo), 'pendente', now(), now()]
  );
  const alvoLabel = alvoUser ? (await db.get('SELECT email FROM users WHERE id=?', [alvoUser]))?.email || alvoUser : '';
  const frase = def.descrever({ payload, alvo_user: alvoUser, alvo_id: alvoId }, alvoLabel);
  await notificarDono(db, 'pedido_admin', `${user.email} quer ${frase}`, {
    corpo: `${payload.motivo || txt(dados.motivo) || 'Sem motivo informado.'} Abra o painel para responder Sim, Não ou conversar.`,
    link: '#/admin/pedidos',
    dados: { pedido: id, acao }
  });
  await audit(db, user, 'pedido.criado', id, frase);
  return { executado: false, pedido: id, frase };
}

export function pedidoRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
  const monta = async (r) => {
    const payload = (() => { try { return JSON.parse(r.payload); } catch { return {}; } })();
    const quem = await db.get('SELECT email,name FROM users WHERE id=?', [r.pedido_por]);
    const alvo = r.alvo_user ? await db.get('SELECT email,name FROM users WHERE id=?', [r.alvo_user]) : null;
    return {
      id: r.id, acao: r.acao, rotulo: ACOES[r.acao]?.rotulo || r.acao,
      frase: ACOES[r.acao]?.descrever({ payload, alvo_user: r.alvo_user, alvo_id: r.alvo_id }, alvo?.email || '') || r.acao,
      pedido_por: quem?.email || r.pedido_por, pedido_por_id: r.pedido_por, pedido_por_nome: quem?.name || '',
      alvo: alvo?.email || null, motivo: r.motivo || payload.motivo || '',
      status: r.status, resposta: r.resposta, erro: r.erro, criado_em: r.created_at, decidido_em: r.updated_at
    };
  };

  // O dono vê tudo; o admin comum vê só os pedidos que ele mesmo fez.
  app.get('/api/admin/pedidos', ...auth.admin, wrap(async (req, res) => {
    const dono = req.user.role === 'owner';
    const rows = dono
      ? await db.all('SELECT * FROM pedidos_admin ORDER BY (status=\'pendente\') DESC, created_at DESC LIMIT 200')
      : await db.all('SELECT * FROM pedidos_admin WHERE pedido_por=? ORDER BY created_at DESC LIMIT 200', [req.user.id]);
    res.json({ itens: await Promise.all(rows.map(monta)), pendentes: (await db.get("SELECT COUNT(*)::int AS n FROM pedidos_admin WHERE status='pendente'")).n, sou_dono: dono });
  }));

  app.post('/api/admin/pedidos/:id/decidir', ...auth.owner, wrap(async (req, res) => {
    const p = await db.get('SELECT * FROM pedidos_admin WHERE id=?', [req.params.id]);
    if (!p) throw new HttpError(404, 'Pedido não encontrado.');
    if (p.status !== 'pendente') throw new HttpError(409, `Esse pedido já foi ${p.status === 'aprovado' ? 'aprovado' : 'recusado'}.`);
    const sim = req.body?.decisao === 'sim';
    const resposta = txt(req.body?.resposta, 400);
    if (!sim) {
      await db.run("UPDATE pedidos_admin SET status='recusado', decidido_por=?, resposta=?, updated_at=? WHERE id=?", [req.user.id, resposta, now(), p.id]);
      await notificar(db, p.pedido_por, 'pedido_decidido', 'Seu pedido foi recusado', {
        corpo: resposta || 'O administrador principal recusou sem comentário.', link: '#/admin/pedidos'
      });
      await audit(db, req.user, 'pedido.recusado', p.id, resposta);
      return res.json({ ok: true, status: 'recusado' });
    }
    const def = ACOES[p.acao];
    if (!def) throw new HttpError(400, 'Essa ação não existe mais no site.');
    const payload = JSON.parse(p.payload);
    try {
      const resultado = await def.executar(db, { ...p, payload }, req.user);
      await db.run("UPDATE pedidos_admin SET status='aprovado', decidido_por=?, resposta=?, updated_at=? WHERE id=?", [req.user.id, resposta, now(), p.id]);
      await notificar(db, p.pedido_por, 'pedido_decidido', 'Seu pedido foi aprovado', {
        corpo: `${def.rotulo}: feito.${resposta ? ` ${resposta}` : ''}`, link: '#/admin/pedidos'
      });
      await audit(db, req.user, 'pedido.aprovado', p.id, def.rotulo);
      res.json({ ok: true, status: 'aprovado', resultado });
    } catch (e) {
      // Aprovado mas falhou na hora de executar: não finge que deu certo.
      await db.run("UPDATE pedidos_admin SET status='falhou', decidido_por=?, erro=?, updated_at=? WHERE id=?", [req.user.id, String(e.message || e).slice(0, 300), now(), p.id]);
      await notificar(db, p.pedido_por, 'pedido_decidido', 'Seu pedido foi aprovado, mas não deu para executar', {
        corpo: String(e.message || e).slice(0, 300), link: '#/admin/pedidos'
      });
      throw e;
    }
  }));
}
