/* TurboCanal Studio: editor de vídeo (ffmpeg.wasm, roda no navegador do usuário)
   e criador de capas (canvas). Nada disso passa pelo servidor nem gasta créditos. */

const MAX_BYTES = 1.5 * 1024 * 1024 * 1024; // limite prático da memória do navegador
let ffmpegPromise = null;
let currentLog = null; // um único repassador de log (evita acumular callbacks)

function getFFmpeg(onLog) {
  currentLog = onLog || null;
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import('/vendor/ffmpeg/ffmpeg/index.js');
      const ff = new FFmpeg();
      ff.on('log', (e) => { if (currentLog) currentLog(e); });
      await ff.load({ coreURL: '/vendor/ffmpeg/core/ffmpeg-core.js', wasmURL: '/vendor/ffmpeg/core/ffmpeg-core.wasm' });
      return ff;
    })().catch((e) => {
      ffmpegPromise = null;
      throw e;
    });
  }
  return ffmpegPromise;
}

/** Processa um arquivo (usado pela tela e pelos testes automatizados). */
export async function processFile(file, op, { start = 0, end = null, duration = null, onProgress } = {}) {
  const logs = [];
  const ff = await getFFmpeg(({ message }) => { logs.push(message); if (logs.length > 400) logs.shift(); });
  const ext = (String(file.name || '').match(/\.([a-z0-9]{2,4})$/i)?.[1] || 'mp4').toLowerCase();
  const inName = 'in.' + ext;
  await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
  logs.length = 0;
  try { await ff.exec(['-hide_banner', '-i', inName]); } catch {}
  const hasAudio = logs.some((l) => /Stream #.*Audio:/.test(l));
  // Duração lida pelo próprio ffmpeg (funciona mesmo se o navegador não mostrar a prévia, ex.: HEVC/MKV)
  if (!duration || !isFinite(duration)) {
    const dl = logs.find((l) => /Duration: \d+:\d+:\d+/.test(l));
    const m = dl && dl.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) duration = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
  }
  const { args, out, mime } = buildArgs(op, { inName, start, end, duration, hasAudio });
  const total = Math.max(0.1, (end ?? duration ?? 60) - start);
  const cap = op.startsWith('shorts') ? Math.min(total, 60) : total;
  const onProg = ({ time }) => onProgress && onProgress(Math.max(0, Math.min(100, Math.round((((time || 0) / 1e6) / cap) * 100))));
  ff.on('progress', onProg);
  logs.length = 0;
  let code;
  try {
    code = await ff.exec(args);
  } finally {
    ff.off('progress', onProg);
  }
  if (code !== 0) {
    try { await ff.deleteFile(inName); } catch {}
    throw new Error('O ffmpeg não conseguiu processar este arquivo. Detalhe: ' + logs.slice(-3).join(' | '));
  }
  const data = await ff.readFile(out);
  try { await ff.deleteFile(inName); await ff.deleteFile(out); } catch {}
  return { blob: new Blob([data], { type: mime }), mime, hasAudio };
}

const fmtTime = (sec) => {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};
export function parseTime(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map((p) => parseFloat(p.replace(',', '.')));
  if (parts.some((n) => isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** Monta os argumentos do ffmpeg para cada operação. Exportado para testes. */
export function buildArgs(op, { inName, start = 0, end = null, duration = null, hasAudio = true }) {
  const len = end != null ? Math.max(0.1, end - start) : duration != null ? Math.max(0.1, duration - start) : null;
  const ss = start > 0 ? ['-ss', String(start)] : [];
  // -t ANTES do -i limita o trecho de ENTRADA (assim acelerar 3s gera 2s, e não 3s de um trecho maior)
  const t = len != null ? ['-t', String(len)] : [];
  const enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p'];
  const aenc = hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an'];
  const tail = ['-movflags', '+faststart'];
  switch (op) {
    case 'trim_fast':
      return { args: [...ss, ...t, '-i', inName, '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...tail, 'out.mp4'], out: 'out.mp4', mime: 'video/mp4' };
    case 'trim_exact':
      return { args: [...ss, ...t, '-i', inName, ...enc, ...aenc, ...tail, 'out.mp4'], out: 'out.mp4', mime: 'video/mp4' };
    case 'shorts_crop': {
      const tt = ['-t', String(Math.min(len ?? 60, 60))];
      return { args: [...ss, ...tt, '-i', inName, '-vf', "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=720:1280,setsar=1", ...enc, ...aenc, ...tail, 'out.mp4'], out: 'out.mp4', mime: 'video/mp4' };
    }
    case 'shorts_blur': {
      const tt = ['-t', String(Math.min(len ?? 60, 60))];
      const fc = '[0:v]split=2[a][b];[a]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=20:2[bg];[b]scale=720:1280:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]';
      return { args: [...ss, ...tt, '-i', inName, '-filter_complex', fc, '-map', '[v]', ...(hasAudio ? ['-map', '0:a?'] : []), ...enc, ...aenc, ...tail, 'out.mp4'], out: 'out.mp4', mime: 'video/mp4' };
    }
    case 'mute':
      return { args: [...ss, ...t, '-i', inName, '-c:v', 'copy', '-an', ...tail, 'out.mp4'], out: 'out.mp4', mime: 'video/mp4' };
    case 'mp3':
      return { args: [...ss, ...t, '-i', inName, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', 'out.mp3'], out: 'out.mp3', mime: 'audio/mpeg' };
    case 'speed': {
      const fc = hasAudio ? '[0:v]setpts=PTS/1.5[v];[0:a]atempo=1.5[a]' : '[0:v]setpts=PTS/1.5[v]';
      return { args: [...ss, ...t, '-i', inName, '-filter_complex', fc, '-map', '[v]', ...(hasAudio ? ['-map', '[a]'] : []), ...enc, ...aenc, ...tail, 'out.mp4'], out: 'out.mp4', mime: 'video/mp4' };
    }
    case 'compress':
      return { args: [...ss, ...t, '-i', inName, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-vf', "scale='min(1280,iw)':-2", ...(hasAudio ? ['-c:a', 'aac', '-b:a', '96k'] : ['-an']), ...tail, 'out.mp4'], out: 'out.mp4', mime: 'video/mp4' };
    case 'gif': {
      const tg = ['-t', String(Math.min(len ?? 8, 10))]; // GIF longo fica gigante
      const fc = 'fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse';
      return { args: [...ss, ...tg, '-i', inName, '-filter_complex', fc, '-loop', '0', 'out.gif'], out: 'out.gif', mime: 'image/gif' };
    }
    case 'rotate_right':
      return { args: [...ss, ...t, '-i', inName, '-vf', 'transpose=1', ...enc, ...aenc, ...tail, 'out.mp4'], out: 'out.mp4', mime: 'video/mp4' };
    case 'rotate_left':
      return { args: [...ss, ...t, '-i', inName, '-vf', 'transpose=2', ...enc, ...aenc, ...tail, 'out.mp4'], out: 'out.mp4', mime: 'video/mp4' };
    case 'flip':
      return { args: [...ss, ...t, '-i', inName, '-vf', 'hflip', ...enc, ...aenc, ...tail, 'out.mp4'], out: 'out.mp4', mime: 'video/mp4' };
    case 'volume_up': {
      const a = hasAudio ? ['-af', 'volume=6dB', '-c:a', 'aac', '-b:a', '160k'] : ['-an'];
      return { args: [...ss, ...t, '-i', inName, '-c:v', 'copy', ...a, ...tail, 'out.mp4'], out: 'out.mp4', mime: 'video/mp4' };
    }
    case 'fade': {
      if (!len || len < 2) throw new Error('Para o fade, marque o início e o fim (precisa de pelo menos 2 segundos).');
      const d = 0.6, fim = (len - d).toFixed(2);
      const vf = `fade=t=in:st=0:d=${d},fade=t=out:st=${fim}:d=${d}`;
      const af = hasAudio ? ['-af', `afade=t=in:st=0:d=${d},afade=t=out:st=${fim}:d=${d}`] : [];
      return { args: [...ss, ...t, '-i', inName, '-vf', vf, ...af, ...enc, ...aenc, ...tail, 'out.mp4'], out: 'out.mp4', mime: 'video/mp4' };
    }
    case 'contact_sheet': {
      const quantos = 6;
      const fps = len && len > quantos ? `${quantos}/${len.toFixed(2)}` : '1/5';
      return { args: [...ss, ...t, '-i', inName, '-vf', `fps=${fps},scale=480:-1,tile=3x2`, '-frames:v', '1', 'out.png'], out: 'out.png', mime: 'image/png' };
    }
    default:
      throw new Error('Operação desconhecida: ' + op);
  }
}

const OPS = [
  ['trim_fast', '✂️ Cortar trecho (rápido, sem perder qualidade)'],
  ['trim_exact', '🎯 Cortar trecho (preciso, recodifica)'],
  ['shorts_crop', '📱 Transformar em Shorts 9:16 (corta o centro, até 60s)'],
  ['shorts_blur', '📱 Transformar em Shorts 9:16 (fundo desfocado, até 60s)'],
  ['speed', '⏩ Acelerar 1,5x'],
  ['mute', '🔇 Remover áudio'],
  ['mp3', '🎵 Extrair áudio (MP3)'],
  ['compress', '🗜️ Comprimir (até 720p, arquivo menor)'],
  ['gif', '🎞️ Virar GIF (até 10s, bom para post e thread)'],
  ['contact_sheet', '🖼️ Mosaico de 6 quadros (para escolher a capa)'],
  ['rotate_right', '↻ Girar 90° para a direita'],
  ['rotate_left', '↺ Girar 90° para a esquerda'],
  ['flip', '🪞 Espelhar (inverter horizontal)'],
  ['volume_up', '🔊 Aumentar o volume (+6 dB)'],
  ['fade', '🌗 Fade no começo e no fim']
];

export async function mountEditor(el, ctx) {
  const { esc, alertBox, state, go } = ctx;
  const preset = state.editorPreset || {};
  state.editorPreset = null;
  const cuts = Array.isArray(preset.cuts) ? preset.cuts.filter((c) => c.end > c.start) : [];
  el.innerHTML = `
    <h1>✂️ Editor de vídeo</h1>
    <p class="muted">Corte, transforme em Shorts, gire, vire GIF, tire um mosaico de quadros para escolher a capa, acelere, aumente o volume ou comprima. Roda <b>no seu navegador</b>: o vídeo não sai do seu computador e não gasta créditos. Depois, é só postar no seu canal.</p>
    ${preset.title ? alertBox('info', `Corte sugerido pela IA: <b>${esc(preset.title)}</b> (${esc(fmtTime(preset.start))} a ${esc(fmtTime(preset.end))}). Escolha o arquivo original do vídeo para aplicar.`) : ''}
    ${cuts.length ? alertBox('info', `A IA achou <b>${cuts.length} cortes</b>:<br>${cuts.map((c, i) => `${i + 1}) ${esc(c.title || 'Corte ' + (i + 1))} (${esc(fmtTime(c.start))} a ${esc(fmtTime(c.end))})`).join('<br>')}<br>Escolha abaixo o arquivo ORIGINAL do vídeo e clique em <b>Fazer os ${cuts.length} Shorts</b>.`) : ''}
    <div class="card">
      <label>Arquivo de vídeo (do seu computador)</label>
      <input type="file" id="edFile" accept="video/*">
      <p class="muted small">Recomendado até 1,5 GB. Vídeos longos em 4K podem ficar lentos: para eles, use "Cortar trecho (rápido)".</p>
      <div id="edArea" style="display:none">
        <video id="edVideo" controls playsinline style="width:100%;max-height:420px;background:#000;border-radius:10px;margin-top:8px"></video>
        <div class="row" style="margin-top:8px">
          <div><label>Início</label><input id="edStart" placeholder="0:00" value="${preset.start != null ? esc(fmtTime(preset.start)) : '0:00'}"></div>
          <div class="fit"><button class="btn sm secondary" type="button" id="edMarkS">⏺ Marcar início aqui</button></div>
          <div><label>Fim</label><input id="edEnd" placeholder="fim do vídeo" value="${preset.end != null ? esc(fmtTime(preset.end)) : ''}"></div>
          <div class="fit"><button class="btn sm secondary" type="button" id="edMarkE">⏹ Marcar fim aqui</button></div>
        </div>
        <p class="small muted" id="edInfo"></p>
        <label>O que fazer</label>
        <select id="edOp">${OPS.map(([k, l]) => `<option value="${k}" ${preset.shorts && k === 'shorts_blur' ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${cuts.length ? `<p><button class="btn" id="edBatch" type="button">✂️ Fazer os ${cuts.length} Shorts</button> <span class="muted small">usa o formato escolhido acima (Shorts com fundo desfocado ou cortando o centro)</span></p>` : ''}
        <p><button class="btn${cuts.length ? ' ghost' : ''}" id="edRun" type="button">Processar</button>
           <button class="btn ghost" id="edFrame" type="button">📸 Usar este quadro como capa</button></p>
        <div id="edProg" class="small muted"></div>
      </div>
      <div id="edMsg"></div>
      <div id="edOut"></div>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const video = $('#edVideo');
  const setInfo = (txt) => { const i = $('#edInfo'); if (i) i.textContent = txt; }; // a tela pode já ter sido trocada
  let file = null;
  let objUrl = null;

  $('#edFile').onchange = () => {
    file = $('#edFile').files[0] || null;
    $('#edOut').innerHTML = '';
    $('#edMsg').innerHTML = '';
    if (!file) return;
    if (file.size > MAX_BYTES) {
      $('#edMsg').innerHTML = alertBox('err', 'Arquivo grande demais para editar no navegador (máx. 1,5 GB). Use o editor do YouTube Studio ou corte antes em outro programa.');
      file = null;
      return;
    }
    if (objUrl) URL.revokeObjectURL(objUrl);
    objUrl = URL.createObjectURL(file);
    video.src = objUrl;
    $('#edArea').style.display = 'block';
    setInfo(`${file.name} · ${(file.size / 1048576).toFixed(1)} MB · carregando prévia…`);
    let ok = false;
    video.onloadedmetadata = () => {
      ok = true;
      setInfo(`Duração: ${fmtTime(video.duration)} · ${video.videoWidth}x${video.videoHeight} · ${(file.size / 1048576).toFixed(1)} MB`);
      if (preset.start != null) video.currentTime = preset.start;
    };
    const noPreview = () => {
      if (ok) return;
      setInfo(`${file.name} · ${(file.size / 1048576).toFixed(1)} MB · Seu navegador não mostra a prévia deste formato (ex.: HEVC do iPhone), mas o editor processa normalmente: digite o início e o fim (ex.: 0:15).`);
    };
    video.onerror = noPreview;
    setTimeout(noPreview, 4000);
  };
  $('#edMarkS').onclick = () => ($('#edStart').value = fmtTime(video.currentTime));
  $('#edMarkE').onclick = () => ($('#edEnd').value = fmtTime(video.currentTime));

  $('#edFrame').onclick = () => {
    if (!video.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const g = c.getContext('2d');
    drawCover(g, video, video.videoWidth, video.videoHeight, 1280, 720);
    state.thumbSource = c.toDataURL('image/jpeg', 0.92);
    go('#/ferramentas/criar-capa');
  };

  const batch = $('#edBatch');
  if (batch) batch.onclick = async () => {
    if (!file) return;
    let op = $('#edOp').value;
    if (!op.startsWith('shorts')) { op = 'shorts_blur'; $('#edOp').value = op; }
    batch.disabled = true; $('#edRun').disabled = true;
    $('#edMsg').innerHTML = ''; $('#edOut').innerHTML = '';
    const prog = $('#edProg');
    const done = [];
    try {
      for (let i = 0; i < cuts.length; i++) {
        const c = cuts[i];
        prog.textContent = i === 0 ? 'Carregando o motor do editor (só na primeira vez, ~32 MB)…' : `Corte ${i + 1} de ${cuts.length}…`;
        const { blob } = await processFile(file, op, {
          start: c.start, end: c.end, duration: isFinite(video.duration) ? video.duration : null,
          onProgress: (pct) => (prog.textContent = `Corte ${i + 1} de ${cuts.length}: ${pct}%`)
        });
        done.push({ ...c, blob, url: URL.createObjectURL(blob), fname: `${(file.name.replace(/\.[^.]+$/, '') || 'video')}-short-${i + 1}.mp4` });
      }
      prog.textContent = '';
      $('#edOut').innerHTML = alertBox('ok', `Pronto! ${done.length} Shorts feitos.`) + done.map((d, i) => `
        <div class="card"><b>${i + 1}) ${esc(d.title || 'Short ' + (i + 1))}</b> <span class="muted small">${esc(fmtTime(d.start))} a ${esc(fmtTime(d.end))} · ${(d.blob.size / 1048576).toFixed(1)} MB</span>
          <video src="${esc(d.url)}" controls style="width:100%;max-height:420px;background:#000;border-radius:10px;margin-top:6px"></video>
          <p><a class="btn sm" href="${d.url}" download="${esc(d.fname)}">⬇️ Baixar</a> <button class="btn sm secondary" type="button" data-postcut="${i}">⬆️ Postar este no meu canal</button></p></div>`).join('');
      $('#edOut').dataset.count = String(done.length);
      for (const b of el.querySelectorAll('[data-postcut]')) b.onclick = () => {
        const d = done[+b.dataset.postcut];
        state.pendingUpload = new File([d.blob], d.fname, { type: 'video/mp4' });
        state.prepDraft = { ...(state.prepDraft || {}), title: ((d.title || state.prepDraft?.title || '') + ' #shorts').trim() };
        go('#/canal/postar');
      };
    } catch (e) {
      prog.textContent = '';
      $('#edMsg').innerHTML = alertBox('err', esc(e.message || String(e)) + (done.length ? ` (${done.length} corte(s) já tinham ficado prontos)` : ''));
    }
    batch.disabled = false; $('#edRun').disabled = false;
  };

  $('#edRun').onclick = async () => {
    if (!file) return;
    const op = $('#edOp').value;
    const start = parseTime($('#edStart').value) || 0;
    const end = parseTime($('#edEnd').value);
    if (end != null && end <= start) {
      $('#edMsg').innerHTML = alertBox('err', 'O fim precisa ser depois do início.');
      return;
    }
    const btn = $('#edRun');
    btn.disabled = true;
    $('#edMsg').innerHTML = '';
    $('#edOut').innerHTML = '';
    const prog = $('#edProg');
    try {
      prog.textContent = 'Carregando o motor do editor (só na primeira vez, ~32 MB)…';
      const { blob, mime } = await processFile(file, op, {
        start, end, duration: isFinite(video.duration) ? video.duration : null,
        onProgress: (pct) => (prog.textContent = `Processando… ${pct}%`)
      });
      const url = URL.createObjectURL(blob);
      const fname = (file.name.replace(/\.[^.]+$/, '') || 'video') + (op.startsWith('shorts') ? '-shorts' : '-editado') + (mime === 'audio/mpeg' ? '.mp3' : '.mp4');
      prog.textContent = '';
      const isVideo = mime.startsWith('video/');
      $('#edOut').innerHTML = `
        ${alertBox('ok', `Pronto! ${(blob.size / 1048576).toFixed(1)} MB.`)}
        ${isVideo ? `<video src="${esc(url)}" controls style="width:100%;max-height:420px;background:#000;border-radius:10px"></video>` : `<audio src="${esc(url)}" controls></audio>`}
        <p class="muted small" id="edOutInfo"></p>
        <p><a class="btn sm" href="${url}" download="${esc(fname)}">⬇️ Baixar</a>
        ${isVideo ? `<button class="btn sm secondary" id="edPost" type="button">⬆️ Postar no meu canal</button>` : ''}</p>`;
      $('#edOut').dataset.url = url;
      $('#edOut').dataset.size = String(blob.size);
      const post = $('#edPost');
      if (post) post.onclick = () => {
        state.pendingUpload = new File([blob], fname, { type: 'video/mp4' });
        if (op.startsWith('shorts')) state.prepDraft = { ...(state.prepDraft || {}), title: (preset.title || state.prepDraft?.title || '') + ' #shorts' };
        go('#/canal/postar');
      };
    } catch (e) {
      prog.textContent = '';
      $('#edMsg').innerHTML = alertBox('err', esc(e.message || String(e)));
    }
    btn.disabled = false;
  };
}

function drawCover(g, img, iw, ih, W, H) {
  const r = Math.max(W / iw, H / ih);
  const w = iw * r;
  const h = ih * r;
  g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

function wrapLines(g, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Desenha a capa (exportado para testes). */
export function drawThumb(canvas, img, o) {
  const W = 1280;
  const H = 720;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = o.bg || '#111';
  g.fillRect(0, 0, W, H);
  if (img) drawCover(g, img, img.naturalWidth || img.videoWidth || img.width, img.naturalHeight || img.videoHeight || img.height, W, H);
  if (o.shade) {
    const grd = o.pos === 'top' ? g.createLinearGradient(0, 0, 0, H * 0.6) : g.createLinearGradient(0, H, 0, H * 0.35);
    grd.addColorStop(0, 'rgba(0,0,0,0.75)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  }
  const size = Math.round(o.size || 110);
  const font = `900 ${size}px Impact, "Arial Black", "Segoe UI Black", sans-serif`;
  g.font = font;
  g.textAlign = o.align || 'center';
  g.textBaseline = 'middle';
  const x = g.textAlign === 'left' ? 60 : g.textAlign === 'right' ? W - 60 : W / 2;
  const lines = wrapLines(g, (o.text || '').toUpperCase(), W - 120).slice(0, 3);
  const small = Math.round(size * 0.45);
  const lh = size * 1.05;
  const blockH = lines.length * lh + (o.text2 ? small * 1.3 : 0);
  let y = o.pos === 'top' ? 70 + lh / 2 : o.pos === 'middle' ? H / 2 - blockH / 2 + lh / 2 : H - 60 - blockH + lh / 2;
  for (const line of lines) {
    g.lineJoin = 'round';
    g.lineWidth = Math.max(6, size / 7);
    g.strokeStyle = o.stroke || '#000';
    g.strokeText(line, x, y);
    g.fillStyle = o.color || '#FFE600';
    g.fillText(line, x, y);
    y += lh;
  }
  if (o.text2) {
    g.font = `800 ${small}px "Segoe UI", Arial, sans-serif`;
    g.lineWidth = Math.max(4, small / 6);
    g.strokeText(o.text2, x, y - lh / 2 + small * 0.9);
    g.fillStyle = '#fff';
    g.fillText(o.text2, x, y - lh / 2 + small * 0.9);
  }
  if (o.badge) {
    g.font = `900 46px Impact, "Arial Black", sans-serif`;
    const bw = g.measureText(o.badge).width + 40;
    g.fillStyle = '#E62117';
    g.fillRect(W - bw - 30, 30, bw, 70);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.fillText(o.badge, W - bw / 2 - 30, 66);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Não foi possível abrir a imagem.'));
    im.src = src;
  });
}

export async function mountThumbMaker(el, ctx) {
  const { esc, alertBox, state, go } = ctx;
  const initialSrc = state.thumbSource || state.lastThumb || null;
  const initialText = state.thumbText || '';
  state.thumbSource = null;
  state.thumbText = null;
  el.innerHTML = `
    <h1>🎨 Criar capa</h1>
    <p class="muted">Monte a capa do vídeo com texto grande e contorno (1280x720, pronta para o YouTube). Use um quadro do vídeo (tirado no Editor) ou uma imagem sua. O site não gera imagem com IA: a arte vem de você, o TurboCanal monta o texto, o contorno e o tamanho certo. Grátis, sem gastar créditos.</p>
    <div class="grid cols2">
      <div class="card">
        <label>Imagem de fundo</label><input type="file" id="tmFile" accept="image/*">
        <label>Texto principal (até 4 palavras funciona melhor)</label><input id="tmText" maxlength="60" value="${esc(initialText)}" placeholder="ex.: NÃO FAÇA ISSO">
        <label>Texto secundário (opcional)</label><input id="tmText2" maxlength="60" placeholder="ex.: o erro de todo iniciante">
        <div class="row">
          <div><label>Posição</label><select id="tmPos"><option value="bottom">Embaixo</option><option value="middle">Meio</option><option value="top">Em cima</option></select></div>
          <div><label>Alinhamento</label><select id="tmAlign"><option value="center">Centro</option><option value="left">Esquerda</option><option value="right">Direita</option></select></div>
        </div>
        <div class="row">
          <div><label>Cor do texto</label><input type="color" id="tmColor" value="#FFE600" style="height:42px"></div>
          <div><label>Contorno</label><input type="color" id="tmStroke" value="#000000" style="height:42px"></div>
          <div><label>Tamanho</label><input type="range" id="tmSize" min="60" max="180" value="120"></div>
        </div>
        <div class="row">
          <div><label>Selo no canto (opcional)</label><input id="tmBadge" maxlength="14" placeholder="ex.: NOVO, AO VIVO"></div>
          <div class="fit"><label style="display:inline"><input type="checkbox" id="tmShade" checked style="width:auto"> escurecer atrás do texto</label></div>
        </div>
        <p><button class="btn" id="tmSave" type="button">✅ Usar esta capa</button> <a class="btn sm ghost" id="tmDl" download="capa-turbocanal.jpg">⬇️ Baixar</a></p>
        <div id="tmMsg"></div>
      </div>
      <div class="card">
        <canvas id="tmCanvas" style="width:100%;border-radius:10px;background:#000"></canvas>
        <p class="muted small">Prévia em tamanho real 1280x720.</p>
        <h3>Como fica no feed</h3>
        <label>Título do vídeo (para a prévia)</label><input id="tmTitle" maxlength="100" value="${esc(state.prepDraft?.title || '')}" placeholder="Título do vídeo">
        <div id="tmFeed"></div>
      </div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const canvas = $('#tmCanvas');
  let img = initialSrc ? await loadImage(initialSrc).catch(() => null) : null;
  const opts = () => ({
    text: $('#tmText').value, text2: $('#tmText2').value, pos: $('#tmPos').value, align: $('#tmAlign').value,
    color: $('#tmColor').value, stroke: $('#tmStroke').value, size: +$('#tmSize').value, shade: $('#tmShade').checked, badge: $('#tmBadge').value.trim().toUpperCase()
  });
  const redraw = () => {
    drawThumb(canvas, img, opts());
    const url = canvas.toDataURL('image/jpeg', 0.9);
    $('#tmDl').href = url;
    $('#tmFeed').innerHTML = feedPreviewHtml({ esc, thumb: url, title: $('#tmTitle').value || 'Título do seu vídeo aparece aqui', channel: state.user?.youtube?.channel_title || state.user?.name || 'Seu canal' });
  };
  for (const id of ['#tmText', '#tmText2', '#tmPos', '#tmAlign', '#tmColor', '#tmStroke', '#tmSize', '#tmShade', '#tmBadge', '#tmTitle']) {
    $(id).oninput = redraw;
    $(id).onchange = redraw;
  }
  $('#tmFile').onchange = async () => {
    const f = $('#tmFile').files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    img = await loadImage(url).catch(() => null);
    redraw();
  };
  $('#tmSave').onclick = () => {
    const url = canvas.toDataURL('image/jpeg', 0.9);
    const bytes = Math.round((url.length - 23) * 0.75);
    if (bytes > 2 * 1024 * 1024) {
      $('#tmMsg').innerHTML = alertBox('err', 'A imagem passou de 2 MB. Diminua os detalhes ou use outra imagem.');
      return;
    }
    state.lastThumb = url;
    $('#tmMsg').innerHTML = alertBox('ok', `Capa pronta (${(bytes / 1024).toFixed(0)} KB). Agora é só enviar para o vídeo: <a href="#/canal">Meu canal → Meus vídeos → Enviar capa</a> (marque "usar a última capa").`);
  };
  redraw();
}

/** Cartão de vídeo estilo feed (claro e escuro, desktop e celular) para testar capa + título. */
export function feedPreviewHtml({ esc, thumb, title, channel }) {
  const card = (theme, width) => {
    const dark = theme === 'dark';
    return `<div style="width:${width}px;max-width:100%;background:${dark ? '#0f0f0f' : '#fff'};padding:10px;border-radius:12px;font-family:Roboto,Arial,sans-serif">
      <div style="position:relative"><img src="${esc(thumb)}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;display:block">
        <span style="position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.8);color:#fff;font-size:11px;padding:1px 4px;border-radius:4px">12:34</span></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <div style="width:32px;height:32px;border-radius:50%;background:#ff5d3b;flex:0 0 32px"></div>
        <div style="min-width:0"><div style="color:${dark ? '#f1f1f1' : '#0f0f0f'};font-weight:600;font-size:${width < 300 ? 13 : 14}px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(title)}</div>
          <div style="color:${dark ? '#aaa' : '#606060'};font-size:12px;margin-top:2px">${esc(channel)} · 12 mil visualizações · há 2 horas</div></div>
      </div></div>`;
  };
  return `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">${card('dark', 340)}${card('light', 340)}${card('dark', 230)}</div>
    <p class="muted small">Teste se o texto da capa e o título se leem bem no tamanho pequeno (como no celular).</p>`;
}
