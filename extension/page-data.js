// Roda no MUNDO DA PÁGINA (não no mundo isolado da extensão) só para LER os dados que o
// próprio YouTube já carregou: título, descrição, tags, views, duração e canal.
// Com isso o painel funciona sem conta e sem gastar nada. Nada é enviado para fora daqui.
(() => {
  const read = () => {
    try {
      const pr = window.ytInitialPlayerResponse || null;
      const vd = pr?.videoDetails;
      if (!vd?.videoId) return null;
      const mf = pr?.microformat?.playerMicroformatRenderer || {};
      return {
        id: vd.videoId,
        title: vd.title || '',
        description: vd.shortDescription || '',
        tags: Array.isArray(vd.keywords) ? vd.keywords : [],
        views: Number(vd.viewCount) || 0,
        durationSec: Number(vd.lengthSeconds) || 0,
        channel: vd.author || '',
        channelId: vd.channelId || '',
        publishedAt: mf.publishDate || mf.uploadDate || null,
        category: mf.category || null,
        live: !!vd.isLiveContent
      };
    } catch { return null; }
  };
  const publish = () => {
    const d = read();
    const el = document.documentElement;
    if (d) {
      const json = JSON.stringify(d);
      if (el.dataset.tcVideo !== json) {
        el.dataset.tcVideo = json;
        document.dispatchEvent(new CustomEvent('tc-video-data'));
      }
    } else if (el.dataset.tcVideo) {
      delete el.dataset.tcVideo;
    }
  };
  publish();
  document.addEventListener('yt-navigate-finish', () => setTimeout(publish, 300));
  setInterval(publish, 1500);
})();
