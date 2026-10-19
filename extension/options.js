import { getCfg, setCfg } from './common.js';

const bu = document.getElementById('bu');
getCfg().then((c) => (bu.value = c.baseUrl));
document.getElementById('save').onclick = async () => {
  let v = bu.value.trim().replace(/\/$/, '');
  if (!/^https?:\/\//.test(v)) v = 'http://' + v;
  await setCfg({ baseUrl: v });
  document.getElementById('msg').innerHTML = ' <span class="ok">Salvo ✓</span>';
};
