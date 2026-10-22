// Filtro de mensagens do bate-papo público.
//
// Mais rígido que o do Roblox, de propósito: o que ele não entende, ele corta.
// Roda no SERVIDOR, antes de a mensagem existir para alguém, e é instantâneo.
// Por que não IA aqui: a IA leva um ou dois segundos (tempo em que a mensagem
// já foi lida), custa por volume, cai quando a API cai, e não dá para provar
// com teste que um telefone nunca passa. Isto aqui dá.
//
// O princípio: nada que leve a conversa para FORA do site passa. Link,
// telefone, e-mail, endereço, rede social, dinheiro. Dentro do site a pessoa
// conversa à vontade.

const TAPA = (n) => '#'.repeat(Math.max(3, Math.min(12, n)));

/** Normaliza as fugas clássicas: "w h a t s", "wh4ts", "ponto com", "(arroba)".
 *  Serve só para DETECTAR; o texto que vai para a tela continua o original
 *  com os pedaços trocados por #. */
export function normalizar(txt) {
  let t = String(txt || '').toLowerCase();
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');          // tira acento
  t = t.replace(/\(\s*arroba\s*\)|\barroba\b/g, '@');
  t = t.replace(/\(\s*ponto\s*\)|\bponto\b/g, '.');
  t = t.replace(/\(\s*traco\s*\)|\bunderline\b|\btraco\b/g, '-');
  t = t.replace(/0/g, 'o');                                         // 0 -> o
  // '@' NÃO vira 'a' aqui: era isso que apagava o arroba vindo de "(arroba)".
  // A variante com '@' como 'a' sai separada, para pegar "wh@ts".
  t = t.replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
       .replace(/5\$?/g, 's').replace(/7/g, 't').replace(/\$/g, 's');
  t = t.replace(/[^a-z0-9.@+-]+/g, ' ');                            // separadores viram espaço
  const semEspaco = t.replace(/\s+/g, '');                          // "w h a t s" -> "whats"
  // "justo": cola SÓ em volta do ponto e do arroba. Colar tudo ("colado")
  // apaga as bordas de palavra de que a regra de site precisa: "meucanal
  // ponto com que tem promocao" virava "...meucanal.comquetem...", e aí o
  // \b depois de "com" não fecha e o endereço passava batido no meio da
  // frase, mesmo sendo pego quando vinha sozinho.
  const justo = t.replace(/\s*([.@])\s*/g, '$1');
  // "dedo": junta SÓ as sequências escritas letra por letra ("w w w . m e u
  // s i t e . c o m" -> "www.meusite.com"), deixando as palavras normais em
  // paz. Sem isso o truque de soletrar o endereço passava no meio da frase:
  // o "colado" junta tudo e some com a borda de palavra que a regra precisa.
  const dedo = t.replace(/\b(?:[a-z0-9.@+-] ){2,}[a-z0-9.@+-]\b/g, (m) => m.replace(/ /g, ''));
  return { solto: t, colado: semEspaco, justo, dedo, coladoA: semEspaco.replace(/@/g, 'a') };
}

/** Cada regra sabe o que procura e o que dizer. A ordem importa: o que é mais
 *  específico (CPF, telefone) vem antes do que é mais geral (sequência de
 *  números), para a explicação ser a certa. */
export const REGRAS = [
  { id: 'link', rotulo: 'endereço de site',
    re: /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|br|io|gg|me|ly|tv|xyz|link|site|app|shop|store|info|co)\b(?:\/\S*)?/gi },
  { id: 'email', rotulo: 'e-mail', re: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi },
  { id: 'cpf', rotulo: 'CPF ou CNPJ', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g },
  { id: 'telefone', rotulo: 'telefone', re: /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?9?\d{4,5}[\s.-]?\d{4,5}\b/g },
  { id: 'cep', rotulo: 'CEP', re: /\b\d{5}-?\d{3}\b/g },
  { id: 'cartao', rotulo: 'número de cartão', re: /\b(?:\d[ -]?){13,19}\b/g },
  { id: 'endereco', rotulo: 'endereço',
    re: /\b(?:rua|avenida|av|alameda|travessa|rodovia|estrada|praca|praça|bairro|quadra|lote|apto|apartamento|bloco)\b[\s.:]*[\wÀ-ÿ'".,º°-]{2,40}/gi },
  { id: 'numeros', rotulo: 'sequência de números', re: /\b\d{6,}\b/g }
];

/** Palavras que não aparecem como padrão, e sim como palavra: procuradas no
 *  texto normalizado (com e sem espaço), então "z a p" e "z4p" também pegam. */
export const PALAVRAS = {
  contato: { rotulo: 'combinar fora do site',
    lista: ['whatsapp', 'whats', 'wpp', 'zap', 'zapzap', 'telegram', 'telegrama', 'discord', 'instagram', 'insta', 'tiktok', 'snapchat', 'facebook', 'messenger', 'skype', 'signal', 'kwai', 'twitter', 'onlyfans', 'meuchat', 'chamanoprivado', 'chamanopv', 'mandadm', 'medm'] },
  dinheiro: { rotulo: 'dinheiro ou compra',
    lista: ['pix', 'chavepix', 'boleto', 'cartaodecredito', 'transferencia', 'deposito', 'vendo', 'vende', 'vender', 'compro', 'compra', 'comprar', 'pagamento', 'pagar', 'dinheiro', 'reais', 'grana', 'lucro', 'investimento', 'investir', 'cripto', 'bitcoin', 'robux', 'giftcard', 'conta premium', 'contapremium', 'barato', 'promocao', 'desconto', 'cupom', 'ganhedinheiro', 'rendaextra', 'trabalheemcasa'] },
  encontro: { rotulo: 'combinar encontro',
    lista: ['meencontra', 'nosencontramos', 'ondevocemora', 'ondevoemora', 'ondevcmora', 'ondetumora', 'ondemora', 'quecidadevoce', 'quecidademora', 'qualseuendereco', 'qualoendereco', 'minhacasa', 'suacasa', 'teencontro', 'marcaai'] },
  pessoal: { rotulo: 'dado pessoal',
    lista: ['meunumero', 'seunumero', 'meutelefone', 'seutelefone', 'meuemail', 'seuemail', 'minhaidade', 'quantosanosvoce', 'quantosanostem', 'mandafoto', 'mandanude', 'manda foto sua'] },
  ofensa: { rotulo: 'ofensa',
    lista: ['viado', 'puta', 'puto', 'caralho', 'porra', 'buceta', 'foder', 'fodase', 'merda', 'cuzao', 'arrombado', 'otario', 'retardado', 'imbecil', 'idiota', 'burro', 'macaco', 'preto fedido', 'morre', 'sematar', 'suicida', 'matarvoce', 'tematar'] }
};

/** Aplica o filtro. Devolve o texto já limpo, o que foi cortado e se a
 *  mensagem inteira deve ser recusada. */
export function filtrar(texto, { limiteBloqueio = 3 } = {}) {
  const original = String(texto ?? '');
  let saida = original;
  const achados = [];

  for (const r of REGRAS) {
    saida = saida.replace(r.re, (m) => {
      // "123 4567" dentro de uma frase normal não é telefone; exige dígitos o bastante
      if (r.id === 'telefone' && (m.replace(/\D/g, '').length < 8)) return m;
      if (r.id === 'cartao' && m.replace(/\D/g, '').length < 13) return m;
      achados.push({ regra: r.id, rotulo: r.rotulo, trecho: m.slice(0, 40) });
      return TAPA(m.length);
    });
  }

  const { solto, colado, justo, dedo, coladoA } = normalizar(saida);

  // Disfarce escrito por extenso ("meucanal ponto com", "fulano arroba gmail
  // ponto com") só aparece depois de normalizar. Aqui não dá para tapar o
  // trecho certo no texto original, então isso BLOQUEIA a mensagem inteira,
  // que é o lado seguro de errar.
  for (const r of REGRAS) {
    if (!['link', 'email'].includes(r.id)) continue;
    const alvo = new RegExp(r.re.source, 'i');
    // Quatro versões, porque o disfarce aparece em cada uma de um jeito:
    // "solto" pega o que já estava escrito normal; "justo" pega "meucanal
    // ponto com" no meio de uma frase (cola só o ponto e o arroba, mantendo
    // as bordas de palavra); "dedo" pega o endereço soletrado; e "colado"
    // pega o resto. Qualquer uma que bata bloqueia a mensagem inteira.
    if ([solto, justo, dedo, colado].some((v) => alvo.test(v)) && !achados.some((a) => a.regra === r.id)) {
      achados.push({ regra: r.id, rotulo: r.rotulo, trecho: '(escrito por extenso)' });
    }
  }

  for (const [chave, grupo] of Object.entries(PALAVRAS)) {
    for (const palavra of grupo.lista) {
      const alvo = palavra.replace(/\s+/g, '');
      const bate = colado.includes(alvo) || coladoA.includes(alvo) || solto.includes(palavra);
      if (!bate) continue;
      achados.push({ regra: chave, rotulo: grupo.rotulo, trecho: palavra });
      // Tapa a palavra no texto visível, inclusive escrita com separadores
      const solta = alvo.split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-zA-Z0-9]{0,2}');
      try { saida = saida.replace(new RegExp(solta, 'gi'), (m) => TAPA(m.length)); } catch {}
      break; // uma marcação por grupo já basta
    }
  }

  // Estes levam a conversa para FORA do site: um só já bloqueia a mensagem.
  // Tapar com # não bastaria, porque o disfarce escrito por extenso continua
  // legível para quem está lendo.
  const GRAVES = new Set(['link', 'email', 'telefone', 'cpf', 'cartao', 'cep', 'contato']);
  const temGrave = achados.some((a) => GRAVES.has(a.regra));
  const bloqueado = temGrave || achados.length >= limiteBloqueio || /^#+$/.test(saida.replace(/\s/g, ''));
  const motivos = [...new Set(achados.map((a) => a.rotulo))];
  return {
    texto: saida,
    limpo: achados.length === 0,
    achados,
    motivos,
    bloqueado,
    aviso: achados.length === 0 ? '' : bloqueado
      ? `Mensagem não enviada: ${motivos.join(', ')}. Combinar coisa fora do site não é permitido aqui.`
      : `Parte da mensagem foi escondida: ${motivos.join(', ')}.`
  };
}

/** Resumo para a auditoria, sem repetir o que foi filtrado. */
export function resumoFiltro(r) {
  return r.limpo ? 'limpa' : `${r.bloqueado ? 'bloqueada' : 'parcial'}: ${r.motivos.join(', ')}`;
}
