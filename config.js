// ═══════════════════════════════════════════════════════════════════
//  CONFIGURAÇÃO DA BARBEARIA — Sm Nalsdesigner
//  Arquivo gerado por criar-barbearia.html. Depois de instalado, nome, logo, WhatsApp e
//  planos podem ser mudados pela aba "Ajustes" do painel (as cores também), sem editar este arquivo.
// ═══════════════════════════════════════════════════════════════════
const BARBEARIA = {
  nome: "Sm Nalsdesigner",
  marca: { linha1: "Sm", linha2: "Nalsdesigner" },
  nomePainel: "Sm Nalsdesigner Admin",
  nomeCurto: "Sm",
  whatsapp: "5585996870852",
  whatsappAvisos: "5585996870852",
  modoDemonstracao: false,
  firebase: {
    "apiKey": "AIzaSyB70WEnC1nyDAxcAxlB4-VdlJ2txXq-7UY",
    "authDomain": "projeto-nails-86130.firebaseapp.com",
    "projectId": "projeto-nails-86130",
    "storageBucket": "projeto-nails-86130.firebasestorage.app",
    "messagingSenderId": "534371403819",
    "appId": "1:534371403819:web:4e93b81298536fde65c26e"
  },
  fcmVapidKey: "BJ-s92thC7KLFsYEYx4VLq9or3kWcDUN4if2jMVc8QSynKNaMGhFNM60z0Ulkl-Il4BE9gHtN_Y2u-5TEeXHRxM",
  adminEmail: "admin@smnalsdesigner.com",
  servicos: [
    {
      "id": "manicure",
      "name": "Manicure",
      "price": 35,
      "duracao": 45
    },
    {
      "id": "pedicure",
      "name": "Pedicure",
      "price": 40,
      "duracao": 50
    },
    {
      "id": "esmaltacao_em_gel",
      "name": "Esmaltação em Gel",
      "price": 25,
      "duracao": 40
    },
    {
      "id": "manicure_pedicure",
      "name": "Manicure + Pedicure",
      "price": 70,
      "duracao": 80
    }
  ],
  planosAtivos: false,
  planos: [],
  cores: {
    "destaque": "#C97D5C",
    "destaqueClaro": "#D69672",
    "destaqueEscuro": "#BB6643",
    "texto": "#F1EAD6",
    "textoCreme2": "#ECE4C7",
    "textoClaro": "#D1C3BF",
    "textoSecundario": "#BDA8A4",
    "textoSuave": "#B39B96",
    "textoApagado": "#A28A84",
    "legenda": "#8D7670",
    "cinzaAzulado": "#784F46",
    "fundo": "#1E1310",
    "fundo2": "#241714",
    "fundo3": "#271915",
    "cartao": "#2E1D19",
    "campo": "#38231F",
    "borda0": "#422A24",
    "borda": "#4A302A",
    "botao": "#543731",
    "detalhe": "#5E3C36",
    "bordaCampo": "#68443D",
    "bordaBotao": "#80544C"
  },
  fonte: "assinatura",   // letra do nome no topo (mudável na aba Ajustes do painel)
};

// ═══════════════════════════════════════════════════════════════════
//  A partir daqui não precisa mexer.
// ═══════════════════════════════════════════════════════════════════

// Preenche nome da barbearia nos elementos marcados com data-marca / data-marca-attr
function aplicarMarca() {
  const valores = {
    nome: BARBEARIA.nome,
    linha1: BARBEARIA.marca.linha1,
    linha2: BARBEARIA.marca.linha2,
    nomePainel: BARBEARIA.nomePainel,
    ano: String(new Date().getFullYear()),
  };
  document.querySelectorAll('[data-marca]').forEach(el => {
    const v = valores[el.dataset.marca];
    if (v != null) el.textContent = v;
  });
  // Logo enviada pelo painel (aba Ajustes): troca as imagens marcadas com data-logo e o favicon
  document.querySelectorAll('img[data-logo]').forEach(img => {
    if (!img.dataset.logoPadrao) img.dataset.logoPadrao = img.getAttribute('src') || '';
    img.src = BARBEARIA.logo || img.dataset.logoPadrao;
  });
  document.querySelectorAll('link[rel="icon"]').forEach(l => {
    if (!l.dataset.iconePadrao) l.dataset.iconePadrao = l.getAttribute('href') || '';
    l.href = BARBEARIA.logo || l.dataset.iconePadrao;
  });
  document.querySelectorAll('[data-marca-attr]').forEach(el => {
    el.dataset.marcaAttr.split(';').forEach(par => {
      const [attr, chave] = par.split(':');
      if (attr && valores[chave] != null) el.setAttribute(attr.trim(), valores[chave]);
    });
  });
}

// Firebase ainda não configurado? (usado pelo site para avisar em vez de ficar carregando)
BARBEARIA.firebasePendente = !BARBEARIA.firebase.apiKey || /COLE_/.test(BARBEARIA.firebase.apiKey + BARBEARIA.firebase.projectId);

// ── Tema: cores do site e do painel ─────────────────────────────
// Os arquivos saem do gerador já pintados com as cores escolhidas na criação (BARBEARIA.cores).
// Na aba "Ajustes" do painel o dono pode trocar as duas cores principais (destaque e fundo), inclusive
// pedindo uma sugestão a partir da logo. A escolha fica em config/barbearia (campo "cores") e o código
// abaixo repinta o CSS e os estilos da tela ao abrir o site/painel (e na hora, quando o dono salva).
const TEMA_BARBEARIA = (function () {
  const PALETA_PADRAO = {
    destaque: '#EBC531', destaqueClaro: '#F5DC4A', destaqueEscuro: '#D9B01C',
    texto: '#F1EAD6', textoCreme2: '#ECE4C7', textoClaro: '#B4BEDC', textoSecundario: '#94A4CC',
    textoSuave: '#8496C4', textoApagado: '#7183B4', legenda: '#5E6E9E', cinzaAzulado: '#284794',
    fundo: '#070E24', fundo2: '#09112C', fundo3: '#0A1330', cartao: '#0C1838', campo: '#0F1F45',
    borda0: '#122452', borda: '#16295C', botao: '#1B3168', detalhe: '#1E3874',
    bordaCampo: '#233F80', bordaBotao: '#2C4E9E',
  };
  const FAMILIA_DESTAQUE = ['destaque', 'destaqueClaro', 'destaqueEscuro'];
  const FAMILIA_FUNDO = ['fundo', 'fundo2', 'fundo3', 'cartao', 'campo', 'borda0', 'borda', 'botao', 'detalhe',
    'bordaCampo', 'bordaBotao', 'legenda', 'textoApagado', 'textoSuave', 'textoSecundario', 'textoClaro', 'cinzaAzulado'];

  const ehHex = h => /^#[0-9A-Fa-f]{6}$/.test(h || '');
  function hexParaRgb(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
  function hexParaHsl(hex) {
    let [r, g, b] = hexParaRgb(hex).map(v => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h, s, l };
  }
  function hslParaHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s = Math.min(1, Math.max(0, s)); l = Math.min(1, Math.max(0, l));
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  // Gera as 22 cores do sistema a partir de duas escolhidas: destaque (dourado) e fundo (azul-marinho)
  function derivarPaleta(destaque, fundo) {
    const pal = Object.assign({}, PALETA_PADRAO);
    destaque = String(destaque).toUpperCase(); fundo = String(fundo).toUpperCase();
    if (destaque !== PALETA_PADRAO.destaque) {
      const b = hexParaHsl(PALETA_PADRAO.destaque), n = hexParaHsl(destaque);
      FAMILIA_DESTAQUE.forEach(k => {
        const c = hexParaHsl(PALETA_PADRAO[k]);
        pal[k] = hslParaHex(c.h + (n.h - b.h), c.s * (b.s ? n.s / b.s : 1), c.l + (n.l - b.l));
      });
      pal.destaque = destaque;
    }
    if (fundo !== PALETA_PADRAO.fundo) {
      const b = hexParaHsl(PALETA_PADRAO.fundo), n = hexParaHsl(fundo);
      FAMILIA_FUNDO.forEach(k => {
        const c = hexParaHsl(PALETA_PADRAO[k]);
        const peso = (1 - c.l) / (1 - b.l);          // tons claros (textos) mexem menos que os fundos
        pal[k] = hslParaHex(c.h + (n.h - b.h), c.s * (b.s ? n.s / b.s : 1), c.l + (n.l - b.l) * peso);
      });
      pal.fundo = fundo;
    }
    return pal;
  }
  // ── Cores a partir da logo ──
  // px: pixels RGBA (Uint8ClampedArray). Devolve { destaque, fundo, vibrante, amostras } ou null se a imagem for vazia.
  function rgbParaHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
  function extrairCoresDaLogo(px) {
    const bins = new Map();
    let total = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;                                  // ignora o fundo transparente
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);       // 8 níveis por canal
      let e = bins.get(key);
      if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; bins.set(key, e); }
      e.n++; e.r += r; e.g += g; e.b += b; total++;
      }
    if (!total) return null;
    const lista = [...bins.values()].map(e => {
      const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
      return Object.assign({ n: e.n, r, g, b }, hexParaHsl(rgbParaHex(r, g, b)));
    });
    const agrupar = filtro => {
      const grupos = new Map();
      lista.filter(filtro).forEach(c => {
        const k = Math.floor(c.h / 30) % 12;
        const g = grupos.get(k) || { n: 0, r: 0, g: 0, b: 0 };
        g.n += c.n; g.r += c.r * c.n; g.g += c.g * c.n; g.b += c.b * c.n; grupos.set(k, g);
      });
      return [...grupos.values()].sort((a, b) => b.n - a.n).map(g => ({ n: g.n, share: g.n / total, hex: rgbParaHex(g.r / g.n, g.g / g.n, g.b / g.n) }));
    };
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    // Destaque: cor viva e clara que mais aparece
    const vivos = agrupar(c => c.s >= 0.35 && c.l >= 0.35 && c.l <= 0.88);
    let destaque = '#D9D9D9', vibrante = false;
    if (vivos.length && vivos[0].share >= 0.02) {
      const h = hexParaHsl(vivos[0].hex);
      destaque = hslParaHex(h.h, clamp(h.s, 0.5, 0.95), clamp(h.l, 0.45, 0.68));
      vibrante = true;
    }
    // Fundo: se a logo tem um tom escuro colorido (ex.: azul-marinho), usa o matiz dele; senão, quase preto neutro
    const escuros = agrupar(c => c.l < 0.35 && c.s >= 0.2);
    let fundo = '#0B0B0B';
    if (escuros.length && escuros[0].share >= 0.06) {
      const h = hexParaHsl(escuros[0].hex);
      fundo = hslParaHex(h.h, clamp(h.s, 0.3, 0.8), 0.09);
    }
    const amostras = agrupar(() => true).slice(0, 6).map(g => g.hex);
    return { destaque, fundo, vibrante, amostras };
  }
  const ESTILOS = [
    { nome: 'Azul e dourado', destaque: '#EBC531', fundo: '#070E24' },
    { nome: 'Preto e dourado', destaque: '#D4AF37', fundo: '#0B0B0B' },
    { nome: 'Verde e dourado', destaque: '#D4AF37', fundo: '#06210F' },
    { nome: 'Vinho e dourado', destaque: '#D4AF37', fundo: '#25070F' },
    { nome: 'Preto e vermelho', destaque: '#E63946', fundo: '#0B0B0F' },
    { nome: 'Grafite e laranja', destaque: '#FF8A1F', fundo: '#15171C' },
  ];

  // ── Repintura da tela ──
  // Troca, no CSS e nos estilos já escritos, cada cor antiga pela nova correspondente.
  // Cada cor guarda todos os valores que já teve (fontes); o novo valor nunca coincide com o de outra cor,
  // então repintar duas vezes o mesmo trecho não estraga nada.
  const temDom = typeof document !== 'undefined' && typeof MutationObserver !== 'undefined';
  const CHAVES = Object.keys(PALETA_PADRAO);
  const RE_HEX = /#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?(?![0-9a-fA-F])/g;
  const RE_RGB = /(rgba?)\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*([,)])/g;
  const RE_RGB2 = /(rgba?)\(\s*(\d+)\s+(\d+)\s+(\d+)\s*([\/)])/g;   // sintaxe nova: rgb(235 197 49 / 0.1)
  const ATRIBUTOS = ['fill', 'stroke', 'stop-color', 'flood-color'];
  const SELETOR = '[style],[fill],[stroke],[stop-color],[flood-color]';
  const fontes = {};
  const folhaGer = new WeakMap();
  let mapaHex = {}, mapaRgb = {}, geracao = 0, observador = null, chaveAtual = '';

  function iniciarFontes() {
    if (fontes[CHAVES[0]]) return;
    const base = BARBEARIA.cores || PALETA_PADRAO;
    CHAVES.forEach(k => { fontes[k] = new Set([String(base[k] || PALETA_PADRAO[k]).toUpperCase()]); });
  }
  function ehFonteDeOutra(hex, k) { return CHAVES.some(j => j !== k && fontes[j].has(hex)); }
  // Se o valor novo coincidir com o de outra cor, mexe 1 ponto num canal (invisível a olho nu)
  function distinta(hex, k, usados) {
    const rgb = hexParaRgb(hex);
    for (let i = 0; i < 30 && (usados.has(rgbParaHex(rgb[0], rgb[1], rgb[2])) || ehFonteDeOutra(rgbParaHex(rgb[0], rgb[1], rgb[2]), k)); i++) {
      const c = i % 3; rgb[c] += rgb[c] >= 255 ? -1 : 1;
    }
    return rgbParaHex(rgb[0], rgb[1], rgb[2]);
  }
  function trocar(txt) {
    return txt
      .replace(RE_HEX, (m, cor, alfa) => { const n = mapaHex['#' + cor.toUpperCase()]; return n ? n + (alfa || '') : m; })
      .replace(RE_RGB, (m, fn, r, g, b, fim) => { const n = mapaRgb[r + ',' + g + ',' + b]; return n ? fn + '(' + n.join(', ') + (fim === ')' ? ')' : ',') : m; })
      .replace(RE_RGB2, (m, fn, r, g, b, fim) => { const n = mapaRgb[r + ',' + g + ',' + b]; return n ? fn + '(' + n.join(' ') + (fim === ')' ? ')' : ' /') : m; });
  }
  const temCor = v => !!v && (v.indexOf('#') >= 0 || v.indexOf('rgb') >= 0);

  function repintarDecl(st) {
    for (let i = 0; i < st.length; i++) {
      const p = st[i], v = st.getPropertyValue(p);
      if (!temCor(v)) continue;
      const n = trocar(v);
      if (n !== v) st.setProperty(p, n, st.getPropertyPriority(p));
    }
  }
  function repintarRegras(regras) {
    for (let i = 0; i < regras.length; i++) {
      const r = regras[i];
      if (r.style) repintarDecl(r.style);
      if (r.cssRules) repintarRegras(r.cssRules);
    }
  }
  function repintarFolhas() {
    for (let i = 0; i < document.styleSheets.length; i++) {
      const f = document.styleSheets[i];
      if (folhaGer.get(f) === geracao) continue;
      folhaGer.set(f, geracao);
      let regras = null;
      try { regras = f.cssRules; } catch (e) { /* folha de outro site (fontes): não tem cor do tema */ }
      if (regras) repintarRegras(regras);
    }
  }
  function repintarEl(el) {
    if (el.nodeType !== 1 || (el.closest && el.closest('[data-sem-tema]'))) return;
    let v = el.getAttribute('style');
    if (temCor(v)) { const n = trocar(v); if (n !== v) el.setAttribute('style', n); }
    for (let i = 0; i < ATRIBUTOS.length; i++) {
      v = el.getAttribute(ATRIBUTOS[i]);
      if (temCor(v)) { const n = trocar(v); if (n !== v) el.setAttribute(ATRIBUTOS[i], n); }
    }
  }
  function repintarArvore(raiz) {
    if (!raiz || raiz.nodeType !== 1) return;
    repintarEl(raiz);
    raiz.querySelectorAll(SELETOR).forEach(repintarEl);
  }
  function observar() {
    if (observador) return;
    observador = new MutationObserver(lista => {
      for (let i = 0; i < lista.length; i++) {
        const m = lista[i];
        if (m.type === 'attributes') repintarEl(m.target);
        else m.addedNodes.forEach(repintarArvore);
      }
      repintarFolhas();
    });
    observador.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'].concat(ATRIBUTOS) });
  }

  // Aplica as cores { destaque, fundo }. Sem cores válidas, volta às cores originais dos arquivos.
  function definir(c) {
    if (!temDom || typeof BARBEARIA === 'undefined' || !BARBEARIA.cores) return;
    const valido = !!c && ehHex(c.destaque) && ehHex(c.fundo);
    const chave = valido ? (c.destaque + c.fundo).toUpperCase() : '';
    if (chave === chaveAtual) return;
    iniciarFontes();
    const pal = valido ? derivarPaleta(c.destaque, c.fundo) : BARBEARIA.cores;
    const alvo = {}, usados = new Set();
    CHAVES.forEach(k => { alvo[k] = distinta(String(pal[k] || PALETA_PADRAO[k]).toUpperCase(), k, usados); usados.add(alvo[k]); });
    CHAVES.forEach(k => fontes[k].add(alvo[k]));
    mapaHex = {}; mapaRgb = {};
    CHAVES.forEach(k => {
      const rgb = hexParaRgb(alvo[k]);
      fontes[k].forEach(h => { mapaHex[h] = alvo[k]; mapaRgb[hexParaRgb(h).join(',')] = rgb; });
    });
    chaveAtual = chave; geracao++;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', alvo.fundo);
    repintarFolhas();
    repintarArvore(document.documentElement);
    observar();
  }

  return { PALETA_PADRAO, ESTILOS, ehHex, derivarPaleta, extrairCoresDaLogo, definir };
})();

// ── Letra do nome no topo do site ────────────────────────────────
// Estilos prontos para as duas linhas do nome grande que aparece no início do site. O dono escolhe um na aba
// "Ajustes" do painel (cartão "Letra do nome no topo"); a escolha fica em config/barbearia (campo "fonte").
// Cada linha (l1 = linha de cima, l2 = linha de baixo) define:
//   fam = fonte, peso, estilo = normal|italic, esp = espaço entre as letras,
//   caixa = uppercase|none (MAIÚSCULAS ou como foi digitado), tam = tamanho (o clamp() encolhe no celular).
// "google" é o trecho do Google Fonts que precisa ser baixado ('' = já vem com o site).
// Para criar um estilo novo, copie um bloco, troque o id e os valores. Cada fonte do Google deve aparecer em um só estilo.
// @@FONTES-INICIO
const FONTES_TOPO = [
  { id: 'classico', nome: 'Clássico', google: '',
    l1: { fam: "'Oswald', sans-serif", peso: 400, estilo: 'normal', esp: '7px', caixa: 'uppercase', tam: 'clamp(30px, 8.5vw, 48px)' },
    l2: { fam: "'Playfair Display', Georgia, serif", peso: 700, estilo: 'italic', esp: '8px', caixa: 'uppercase', tam: 'clamp(44px, 12.5vw, 72px)', mt: '8px' } },
  { id: 'elegante', nome: 'Elegante', google: 'family=Cinzel:wght@500;600&family=Cormorant+Garamond:ital,wght@1,600',
    l1: { fam: "'Cinzel', Georgia, serif", peso: 500, estilo: 'normal', esp: '8px', caixa: 'uppercase', tam: 'clamp(26px, 7.2vw, 42px)' },
    l2: { fam: "'Cormorant Garamond', Georgia, serif", peso: 600, estilo: 'italic', esp: '6px', caixa: 'uppercase', tam: 'clamp(44px, 12.5vw, 76px)', mt: '6px' } },
  { id: 'moderno', nome: 'Moderno', google: 'family=Montserrat:wght@500;800',
    l1: { fam: "'Montserrat', Arial, sans-serif", peso: 500, estilo: 'normal', esp: '10px', caixa: 'uppercase', tam: 'clamp(20px, 5.6vw, 32px)' },
    l2: { fam: "'Montserrat', Arial, sans-serif", peso: 800, estilo: 'normal', esp: '3px', caixa: 'uppercase', tam: 'clamp(32px, 9vw, 56px)', mt: '10px' } },
  { id: 'forte', nome: 'Forte', google: 'family=Bebas+Neue&family=Anton',
    l1: { fam: "'Bebas Neue', Impact, sans-serif", peso: 400, estilo: 'normal', esp: '9px', caixa: 'uppercase', tam: 'clamp(34px, 9.5vw, 56px)' },
    l2: { fam: "'Anton', Impact, sans-serif", peso: 400, estilo: 'normal', esp: '4px', caixa: 'uppercase', tam: 'clamp(46px, 13vw, 80px)', mt: '6px' } },
  { id: 'vintage', nome: 'Vintage', google: 'family=Josefin+Sans:wght@400&family=Abril+Fatface',
    l1: { fam: "'Josefin Sans', sans-serif", peso: 400, estilo: 'normal', esp: '10px', caixa: 'uppercase', tam: 'clamp(24px, 6.6vw, 38px)' },
    l2: { fam: "'Abril Fatface', Georgia, serif", peso: 400, estilo: 'normal', esp: '3px', caixa: 'uppercase', tam: 'clamp(40px, 11.5vw, 68px)', mt: '8px' } },
  { id: 'assinatura', nome: 'Assinatura', google: 'family=Yellowtail',
    l1: { fam: "'Yellowtail', cursive", peso: 400, estilo: 'normal', esp: '2px', caixa: 'none', tam: 'clamp(38px, 10vw, 60px)' },
    l2: { fam: "'Yellowtail', cursive", peso: 400, estilo: 'normal', esp: '1px', caixa: 'none', tam: 'clamp(56px, 16vw, 100px)', mt: '0px' } },
];
// CSS de uma linha em miniatura (usado nas prévias do painel e do gerador; escala 0.42 = 42% do tamanho real)
function estiloLinhaFonte(l, escala) {
  const m = /,\s*([\d.]+)px\)\s*$/.exec(l.tam);
  const tam = Math.round((m ? parseFloat(m[1]) : 40) * escala);
  return 'font-family:' + l.fam + ';font-weight:' + l.peso + ';font-style:' + l.estilo + ';font-size:' + tam + 'px;' +
    'letter-spacing:' + (Math.round(parseFloat(l.esp) * escala * 10) / 10) + 'px;text-transform:' + l.caixa + ';line-height:1.15;';
}
// @@FONTES-FIM
const FONTES_TOPO_TODAS = FONTES_TOPO.map(f => f.google).filter(Boolean).join('&');   // todas de uma vez (prévia no painel)

function fonteTopoAtual() {
  return FONTES_TOPO.find(f => f.id === BARBEARIA.fonte) || FONTES_TOPO[0];
}
// Baixa fontes do Google Fonts por meio de um <link> com este id (se já existir, só atualiza o endereço)
function carregarFontesGoogle(consulta, id) {
  if (!consulta || typeof document === 'undefined') return;   // (no service worker não existe document)
  const href = 'https://fonts.googleapis.com/css2?' + consulta + '&display=swap';
  let l = document.getElementById(id);
  if (!l) { l = document.createElement('link'); l.id = id; l.rel = 'stylesheet'; (document.head || document.documentElement).appendChild(l); }
  if (l.getAttribute('href') !== href) l.setAttribute('href', href);
}
// Passa o estilo escolhido para o CSS do site (variáveis --topo1-* e --topo2-*, lidas em index.html)
function aplicarFonteTopo() {
  if (typeof document === 'undefined') return;
  const f = fonteTopoAtual();
  const raiz = document.documentElement.style;
  [['topo1', f.l1], ['topo2', f.l2]].forEach(par => {
    const p = '--' + par[0] + '-', l = par[1];
    raiz.setProperty(p + 'fonte', l.fam);
    raiz.setProperty(p + 'peso', String(l.peso));
    raiz.setProperty(p + 'estilo', l.estilo);
    raiz.setProperty(p + 'espaco', l.esp);
    raiz.setProperty(p + 'caixa', l.caixa);
    raiz.setProperty(p + 'tam', l.tam);
    raiz.setProperty(p + 'mt', l.mt || '0px');
  });
  carregarFontesGoogle(f.google, 'fonte-topo-css');
}

// ── Ajustes feitos pelo painel (aba "Ajustes") ───────────────────
// Ficam no Firebase (config/barbearia) e valem por cima do que está escrito acima.
// A última versão fica guardada no aparelho para a tela já abrir certa, sem piscar.
BARBEARIA.logo = '';
BARBEARIA.tema = null;
const AJUSTES_CACHE_KEY = 'barbearia_ajustes_' + BARBEARIA.firebase.projectId;

function aplicarAjustes(o) {
  if (!o || typeof o !== 'object') return;
  if (o.nome) { BARBEARIA.nome = o.nome; BARBEARIA.nomePainel = o.nomePainel || (o.nome + ' Admin'); }
  if (o.linha1) BARBEARIA.marca.linha1 = o.linha1;
  if (o.linha2 != null) BARBEARIA.marca.linha2 = o.linha2;
  if (o.nomeCurto) BARBEARIA.nomeCurto = o.nomeCurto;
  if (o.whatsapp) { BARBEARIA.whatsapp = o.whatsapp; BARBEARIA.whatsappAvisos = o.whatsapp; }
  if (typeof o.planosAtivos === 'boolean') BARBEARIA.planosAtivos = o.planosAtivos;
  if (Array.isArray(o.planos)) BARBEARIA.planos = o.planos;
  if ('logo' in o) BARBEARIA.logo = o.logo || '';
  if (FONTES_TOPO.some(f => f.id === o.fonte)) BARBEARIA.fonte = o.fonte;   // letra do nome no topo do site
  // Cores escolhidas no painel (aba Ajustes): { destaque, fundo }. Sem elas, vale o que foi escolhido na criação.
  const cs = o.cores;
  BARBEARIA.tema = (cs && TEMA_BARBEARIA.ehHex(cs.destaque) && TEMA_BARBEARIA.ehHex(cs.fundo))
    ? { destaque: cs.destaque.toUpperCase(), fundo: cs.fundo.toUpperCase() } : null;
  TEMA_BARBEARIA.definir(BARBEARIA.tema);
  aplicarFonteTopo();
}
try { aplicarAjustes(JSON.parse(localStorage.getItem(AJUSTES_CACHE_KEY) || 'null')); } catch (e) { /* sem cache */ }
aplicarFonteTopo();   // primeira visita (sem cache): usa a letra escolhida na criação do site

// Busca os ajustes atuais no Firebase. Retorna true se mudou algo em relação ao que a tela já usava.
async function carregarAjustesRemotos() {
  if (BARBEARIA.firebasePendente) return false;
  try {
    const doc = await firebase.firestore().collection('config').doc('barbearia').get();
    if (!doc.exists) return false;
    const o = doc.data() || {};
    delete o.atualizadoEm;
    const txt = JSON.stringify(o);
    let mudou = true;
    try { mudou = localStorage.getItem(AJUSTES_CACHE_KEY) !== txt; localStorage.setItem(AJUSTES_CACHE_KEY, txt); } catch (e) {}
    aplicarAjustes(o);
    return mudou;
  } catch (e) { return false; }
}

// Avisa (faixa vermelha no topo) se o Firebase ainda não foi configurado
(function () {
  const pendente = BARBEARIA.firebasePendente;
  if (!pendente || typeof document === 'undefined') return;   // (no service worker não existe document)
  document.addEventListener('DOMContentLoaded', () => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#B03030;color:#fff;font:600 14px Roboto,Arial,sans-serif;padding:10px 16px;text-align:center;';
    d.textContent = 'Configuração pendente: edite o arquivo config.js e cole os dados do Firebase.';
    document.body.appendChild(d);
  });
})();
