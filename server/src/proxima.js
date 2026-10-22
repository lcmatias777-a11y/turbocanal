// "Sua próxima ação": UMA recomendação por vez, escolhida a partir do que os
// números do canal realmente mostram.
//
// Regras que eu me impus aqui:
//   - Nada é sugerido sem o dado que sustenta. Se não há dado, a tela diz isso
//     e oferece um passo de preparação, em vez de fabricar uma oportunidade.
//   - Cada sugestão morre sozinha quando deixa de ser verdade (são recalculadas
//     do zero a cada visita, não ficam guardadas).
//   - Dá para dispensar. Dispensada, some por 14 dias.

import { HttpError, uid, now } from './util.js';

const DIAS_DISPENSA = 14;
const CACHE_MIN = 180; // 3 horas: ler o Analytics a cada visita queimaria a cota do YouTube
const n = (v) => Number(v || 0).toLocaleString('pt-BR');
const d1 = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/** Monta as candidatas a partir dos sinais já calculados. A ordem da lista é a
 *  prioridade: a primeira que sobreviver aos filtros é a que aparece. */
export function escolherAcoes({ canalLigado, xray, horarios, comentariosSemResposta, iaLigada, temAvaliacao }) {
  const fora = [];

  if (!canalLigado) {
    return [{
      chave: 'vincular_canal', tipo: 'preparo', titulo: 'Vincule seu canal do YouTube',
      porque: 'Sem isso eu só consigo ver números públicos. Com o canal ligado eu leio retenção, inscritos por vídeo e o seu histórico de publicação, que é de onde sai todo o resto.',
      dado: null, botao: { texto: 'Vincular meu canal', href: '/api/auth/google?connect=1', externo: true }
    }];
  }

  const camp = xray?.campeoes?.[0];
  const soView = xray?.soView?.[0];
  const melhorF = xray?.melhorFaixa, piorF = xray?.piorFaixa;

  if (camp && xray.base.analisados >= 3 && camp.views >= 300 && camp.inscritosPorMil > (xray.base.medianaInscritosPorMil || 0) * 1.5) {
    fora.push({
      chave: 'continuacao_' + camp.id, tipo: 'oportunidade',
      titulo: `Faça uma continuação de “${camp.titulo}”`,
      porque: 'Esse vídeo converte espectador em inscrito muito acima do resto do canal. Assunto que faz isso costuma repetir.',
      dado: `${d1(camp.inscritosPorMil)} inscritos por mil views, contra ${d1(xray.base.medianaInscritosPorMil)} na mediana dos seus ${xray.base.analisados} vídeos comparados.`,
      botao: { texto: 'Ver o raio-X dos meus vídeos', href: '#/ferramentas/raiox' }
    });
  }

  // melhorFaixa/piorFaixa já vêm sem os Shorts (que rodam em loop e não dão para
  // comparar com vídeo longo), então aqui a comparação é entre iguais.
  if (melhorF && piorF && melhorF.id !== piorF.id && melhorF.retencaoMediana >= piorF.retencaoMediana * 1.3) {
    fora.push({
      chave: 'formato_' + melhorF.id, tipo: 'oportunidade',
      titulo: `Seu próximo vídeo normal cabe melhor em ${melhorF.nome}`,
      porque: 'Nessa duração o seu público fica até bem mais tarde. Não é regra do YouTube, é o que o seu canal vem mostrando. (Shorts ficam de fora desta conta: eles repetem sozinhos.)',
      dado: `${d1(melhorF.retencaoMediana)}% assistido em ${melhorF.videos} vídeos de ${melhorF.nome}, contra ${d1(piorF.retencaoMediana)}% em ${piorF.videos} de ${piorF.nome}.`,
      botao: { texto: 'Ver retenção por tamanho', href: '#/ferramentas/raiox' }
    });
  }

  if (horarios?.combinacao && horarios.combinacao.diferenca >= 25 && horarios.combinacao.firme && horarios.combinacao.robusta) {
    fora.push({
      chave: 'horario_' + horarios.combinacao.dia + '_' + horarios.combinacao.faixa, tipo: 'oportunidade',
      titulo: `Publique ${horarios.combinacao.nome}`,
      porque: 'É quando os seus vídeos renderam mais. Vale testar no próximo, não mudar tudo de uma vez.',
      dado: `Mediana de ${n(horarios.combinacao.mediana)} views nos ${horarios.combinacao.videos} vídeos publicados nesse horário (${horarios.combinacao.diferenca >= 0 ? '+' : ''}${horarios.combinacao.diferenca}% sobre a mediana geral).`,
      botao: { texto: 'Ver o melhor horário', href: '#/ferramentas/horarios' }
    });
  }

  if (soView && soView.views >= 1000 && Number(soView.esperados) >= 3 && soView.inscritosLiquidos < soView.esperados / 2) {
    fora.push({
      chave: 'conversao_baixa_' + soView.id, tipo: 'atencao',
      titulo: `“${soView.titulo}” converteu menos inscrito do que o normal do seu canal`,
      porque: 'Pela taxa mediana do seu canal, esse vídeo renderia mais inscritos do que rendeu. Vale olhar o que ele tem de diferente. Não quer dizer que o público é de fora do nicho.',
      dado: `${n(soView.views)} views renderiam cerca de ${d1(soView.esperados)} inscrito(s) pela sua taxa mediana, e vieram ${soView.inscritosLiquidos}.`,
      botao: { texto: 'Comparar com os outros vídeos', href: '#/ferramentas/raiox' }
    });
  }

  if (comentariosSemResposta > 0) {
    fora.push({
      chave: 'responder_comentarios', tipo: 'preparo',
      titulo: `Responda ${comentariosSemResposta} comentário${comentariosSemResposta > 1 ? 's' : ''} do seu canal`,
      porque: 'Responder cedo é a coisa mais barata que existe para transformar quem comentou em quem volta.',
      dado: `${comentariosSemResposta} comentário(s) recente(s) ainda sem resposta sua.`,
      botao: { texto: 'Abrir os comentários', href: '#/canal/comentarios' }
    });
  }

  if (xray && xray.base.analisados < 3) {
    fora.push({
      chave: 'poucos_videos', tipo: 'preparo',
      titulo: 'Ainda não dá para recomendar com segurança',
      porque: 'Com poucos vídeos com views no período, qualquer conclusão minha seria chute. Publique mais alguns e eu volto a falar.',
      dado: `${xray.base.analisados} de ${xray.base.total} vídeos entraram na comparação.`,
      botao: { texto: 'Preparar a próxima publicação', href: '#/ferramentas/preparar' }
    });
  }

  if (!iaLigada) {
    fora.push({
      chave: 'ligar_ia', tipo: 'preparo', titulo: 'A IA do site ainda não está ligada',
      porque: 'As ferramentas de IA avisam e não cobram nada enquanto não houver chave. Ligar destrava auditoria do canal, títulos e os resumos.',
      dado: null, botao: { texto: 'Abrir configurações', href: '#/admin/config' }, soDono: true
    });
  }

  if (!temAvaliacao) {
    fora.push({
      chave: 'avaliar_site', tipo: 'preparo', titulo: 'Conte o que você achou do TurboCanal',
      porque: 'É a única forma de eu saber o que está faltando aqui.',
      dado: null, botao: { texto: 'Deixar uma avaliação', href: '#/avaliacoes' }
    });
  }

  return fora;
}

export function proximaRoutes(app, db, auth) {
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  app.get('/api/proxima-acao', auth.required, wrap(async (req, res) => {
    const user = req.user;
    const canalLigado = !!(await db.get('SELECT 1 AS x FROM yt_tokens WHERE user_id=?', [user.id]));

    // A cota da YouTube Data API é compartilhada por TODO o site (10 mil unidades
    // por dia). Ler o canal a cada abertura do painel queimaria a cota com poucos
    // usuários, então o resultado fica guardado por algumas horas. "atualizar=1"
    // força a releitura quando a pessoa pedir.
    const chave = 'prox:' + user.id;
    if (req.query.atualizar !== '1') {
      const c = await db.get('SELECT dados FROM cache_resposta WHERE chave=? AND ate > ?', [chave, now()]);
      if (c) { try { return res.json({ ...JSON.parse(c.dados), doCache: true }); } catch {} }
    }

    let xray = null, horarios = null;
    if (canalLigado) {
      try {
        const { myVideoXray, myPublicVideos } = await import('./channel.js');
        const { analisarVideos } = await import('./xray.js');
        const { analisarHorarios } = await import('./schedule.js');
        const dados = await myVideoXray(db, user, 90);
        xray = analisarVideos(dados.videos);
        const pub = await myPublicVideos(db, user, 50);
        horarios = analisarHorarios(pub.videos.map((v) => ({ titulo: v.title, views: v.views, publicado: v.publishedAt })), { tz: String(req.query.fuso || 'America/Sao_Paulo').slice(0, 60) });
      } catch (e) {
        // Canal ligado mas o YouTube não respondeu: diz isso, não finge que não há nada.
        return res.json({
          acao: null, total: 0,
          erro: `Não consegui ler os números do seu canal agora: ${String(e.message || e).slice(0, 200)}`
        });
      }
    }

    const iaLigada = !!((await db.get("SELECT value FROM settings WHERE key='gemini_api_key'"))?.value || process.env.GEMINI_API_KEY);
    const temAvaliacao = !!(await db.get('SELECT 1 AS x FROM reviews WHERE user_id=?', [user.id]));

    const todas = escolherAcoes({ canalLigado, xray, horarios, comentariosSemResposta: 0, iaLigada, temAvaliacao })
      .filter((a) => !a.soDono || user.role === 'owner');

    const dispensadas = await db.all('SELECT chave FROM acoes_dispensadas WHERE user_id=? AND ate > ?', [user.id, now()]);
    const fora = new Set(dispensadas.map((d) => d.chave));
    const validas = todas.filter((a) => !fora.has(a.chave));

    const corpo = { acao: validas[0] || null, total: validas.length, dispensadas: fora.size, canalLigado };
    if (canalLigado) {
      const ate = new Date(Date.now() + CACHE_MIN * 60000).toISOString();
      await db.run('INSERT INTO cache_resposta(chave,dados,ate) VALUES(?,?,?) ON CONFLICT(chave) DO UPDATE SET dados=EXCLUDED.dados, ate=EXCLUDED.ate',
        [chave, JSON.stringify(corpo), ate]);
    }
    res.json(corpo);
  }));

  app.post('/api/proxima-acao/dispensar', auth.required, wrap(async (req, res) => {
    const chave = String(req.body?.chave || '').trim().slice(0, 120);
    if (!chave) throw new HttpError(400, 'Qual ação você quer dispensar?');
    const ate = new Date(Date.now() + DIAS_DISPENSA * 86400e3).toISOString();
    await db.run('DELETE FROM acoes_dispensadas WHERE user_id=? AND chave=?', [req.user.id, chave]);
    await db.run('INSERT INTO acoes_dispensadas(id,user_id,chave,ate,created_at) VALUES(?,?,?,?,?)', [uid(), req.user.id, chave, ate, now()]);
    await db.run('DELETE FROM cache_resposta WHERE chave=?', ['prox:' + req.user.id]);
    res.json({ ok: true, ate, dias: DIAS_DISPENSA });
  }));
}
