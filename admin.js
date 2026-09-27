// ── Firebase ─────────────────────────────────────
const firebaseConfig = BARBEARIA.firebase;   // vem do config.js
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ── Push Notifications (FCM) ─────────────────────
// Chave pública VAPID deste projeto: console do Firebase >
// Configurações do projeto > Cloud Messaging > Certificados push da Web.
// Enquanto estiver vazia, o painel funciona normal e só não registra push.
const FCM_VAPID_KEY = BARBEARIA.fcmVapidKey || '';   // vem do config.js
let _messaging = null;
let _fcmToken = null;
try {
  _messaging = firebase.messaging();
} catch(e) { console.warn('FCM não suportado:', e); }

// ── Estado Global (declarado no topo para evitar TDZ) ────────────
let allAgendamentos = [];
let unsubscribe = null;
let _agendamentosKnownIds = null;
let _clientesFirestore = {};
let _clientListCache = [];
let datasEspeciais = {};
let deAlmocoAtivo = false;
let _notificacoes = [];
let _notifPanelOpen = false;

const DIAS_SEMANA = [
  { key:'domingo', label:'Domingo' },
  { key:'segunda', label:'Segunda-feira' },
  { key:'terca',   label:'Terca-feira' },
  { key:'quarta',  label:'Quarta-feira' },
  { key:'quinta',  label:'Quinta-feira' },
  { key:'sexta',   label:'Sexta-feira' },
  { key:'sabado',  label:'Sabado' },
];

const DEFAULT_HORARIOS = {
  domingo: { ativo:false, inicio:'08:00', fim:'18:00', almoco:false, almoco_inicio:'12:00', almoco_fim:'13:00' },
  segunda: { ativo:true,  inicio:'08:00', fim:'19:00', almoco:false, almoco_inicio:'12:00', almoco_fim:'13:00' },
  terca:   { ativo:true,  inicio:'08:00', fim:'19:00', almoco:false, almoco_inicio:'12:00', almoco_fim:'13:00' },
  quarta:  { ativo:true,  inicio:'08:00', fim:'19:00', almoco:false, almoco_inicio:'12:00', almoco_fim:'13:00' },
  quinta:  { ativo:true,  inicio:'08:00', fim:'19:00', almoco:false, almoco_inicio:'12:00', almoco_fim:'13:00' },
  sexta:   { ativo:true,  inicio:'08:00', fim:'19:00', almoco:false, almoco_inicio:'12:00', almoco_fim:'13:00' },
  sabado:  { ativo:true,  inicio:'08:00', fim:'17:00', almoco:false, almoco_inicio:'12:00', almoco_fim:'13:00' },
};

let horariosConfig = JSON.parse(JSON.stringify(DEFAULT_HORARIOS));


// ── Login (Firebase Authentication) ──────────────
// O painel pede só a senha. Por trás, ela entra com este e-mail fixo,
// que precisa existir em Authentication > Users no console do Firebase,
// com a senha que você quiser. Não existe senha escrita neste arquivo.
const ADMIN_EMAIL = BARBEARIA.adminEmail;   // vem do config.js
const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

let SERVICES = BARBEARIA.servicos.map(s => ({ id: s.id, name: s.name, price: s.price, duracao: s.duracao }));   // vem do config.js, até o painel salvar sua própria lista

// ── Auth ─────────────────────────────────────────

let _adminIniciado = false;

function mostrarPainel() {
  document.getElementById('login-screen').style.cssText = 'display:none!important;';
  document.getElementById('admin-panel').style.cssText  = 'display:flex!important;';
  if (!_adminIniciado) { _adminIniciado = true; initAdmin(); }
}

function mostrarLogin() {
  document.getElementById('login-screen').style.cssText = 'display:flex!important;';
  document.getElementById('admin-panel').style.cssText  = 'display:none!important;';
  const btn = document.querySelector('.btn-login');
  if (btn) { btn.textContent = 'Entrar'; btn.disabled = false; }
}

function erroLoginTexto(code) {
  switch (code) {
    case 'auth/invalid-email':     return 'E-mail inválido.';
    case 'auth/user-disabled':     return 'Este acesso foi desativado.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':return 'E-mail ou senha incorretos.';
    case 'auth/too-many-requests': return 'Muitas tentativas. Aguarde alguns minutos.';
    case 'auth/network-request-failed': return 'Sem conexão. Tente de novo.';
    default: return 'Não foi possível entrar. Tente de novo.';
  }
}

async function doLogin() {
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  if (!pass)  { errEl.textContent = 'Digite a senha.';  return; }
  const btn = document.querySelector('.btn-login');
  btn.textContent = 'Entrando...';
  btn.disabled = true;
  try {
    await auth.signInWithEmailAndPassword(ADMIN_EMAIL, pass);
    // onAuthStateChanged abre o painel
  } catch (e) {
    errEl.textContent = erroLoginTexto(e.code);
    btn.textContent = 'Entrar';
    btn.disabled = false;
  }
}

async function doLogout() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  try { await auth.signOut(); } catch(e) {}
  document.getElementById('login-pass').value  = '';
  document.getElementById('login-error').textContent = '';
  location.reload();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') doLogin();
});

// A sessão fica salva no próprio Firebase: quem já entrou não precisa digitar de novo.
auth.onAuthStateChanged(user => {
  if (user) mostrarPainel(); else mostrarLogin();
});

function initAdmin() {
  const el = document.getElementById('admin-date');
  if (el) el.textContent = new Date().toLocaleDateString('pt-BR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  loadAgendamentos();
  preencherOpcoesPlano();
  carregarPrecosServicos();
  carregarFormasPagamento();
  carregarGaleria();
  verificarAniversariosGlobal();
  verificarPlanosGlobal();
  carregarClientesFirestore().then(() => { try { renderDashboard(); } catch (e) {} });
  solicitarPermissaoNotificacao();
  if ('Notification' in window && Notification.permission === 'granted') iniciarPushNotifications();
  atualizarBotaoPush();
  renderNotifPanel(); // inicia painel vazio
}

// ── Ajustes da barbearia (aba Ajustes): identidade, logo e planos ─────────
// Gravados em config/barbearia; site e painel leem esse documento por cima do config.js.
let _logoPendente;      // undefined = sem mudança; '' = remover a logo; 'data:image...' = nova logo
let _planosEdit = [];   // rascunho dos planos que está sendo editado na tela
let GALERIA_FOTOS = [];  // fotos da galeria salvas (config/galeria)
let _galeriaEdit = [];   // rascunho da galeria em edição na tela
const GALERIA_MAX_CHARS = 500000; // limite por foto (~370KB de imagem já comprimida)
let _servicosEdit = []; // rascunho dos serviços (com adições/remoções/ordem) que está sendo editado na tela
const LOGO_MAX_CHARS = 600000;   // limite de tamanho da logo guardada (~450 KB de imagem)

function ajStatus(id, texto, cor) {
  const el = document.getElementById(id);
  if (el) { el.style.color = cor || '#BDA8A4'; el.textContent = texto || ''; }
}

function renderAjustes(manterCores) {
  if (!document.getElementById('aj-nome')) return;
  _logoPendente = undefined;
  const set = (id, v) => { document.getElementById(id).value = v || ''; };
  set('aj-nome', BARBEARIA.nome);
  set('aj-linha1', BARBEARIA.marca.linha1);
  set('aj-linha2', BARBEARIA.marca.linha2);
  set('aj-nomecurto', BARBEARIA.nomeCurto);
  set('aj-whatsapp', BARBEARIA.whatsapp);
  atualizarPreviewLogo();
  ajStatus('aj-identidade-status', '');
  document.getElementById('aj-planos-ativos').checked = BARBEARIA.planosAtivos !== false;
  _planosEdit = JSON.parse(JSON.stringify(BARBEARIA.planos));
  renderPlanosEditor();
  ajStatus('aj-planos-status', '');
  _fonteEdit = fonteTopoAtual().id;
  renderFontesAjuste();
  ajStatus('aj-fonte-status', '');
  renderCoresAjuste(manterCores);
}

// ── Logo ──
function atualizarPreviewLogo() {
  const img = document.getElementById('aj-logo-preview');
  if (!img) return;
  const url = _logoPendente !== undefined ? _logoPendente : BARBEARIA.logo;
  img.src = url || 'logo_emblema.png';
}
function escolherLogo(input) {
  const arquivo = input.files && input.files[0];
  input.value = '';
  if (!arquivo) return;
  if (!/^image\//.test(arquivo.type)) { ajStatus('aj-identidade-status', 'Escolha um arquivo de imagem (PNG, JPG ou SVG).', '#e05555'); return; }
  const leitor = new FileReader();
  leitor.onload = () => {
    const img = new Image();
    img.onload = () => {
      let url = '';
      for (const max of [512, 384, 256]) {          // reduz até caber no limite
        const esc = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * esc));
        cv.height = Math.max(1, Math.round(img.height * esc));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        url = cv.toDataURL('image/png');            // PNG mantém o fundo transparente
        if (url.length < LOGO_MAX_CHARS) break;
      }
      if (url.length >= LOGO_MAX_CHARS) { ajStatus('aj-identidade-status', 'Imagem muito pesada. Use uma logo mais simples.', '#e05555'); return; }
      _logoPendente = url;
      atualizarPreviewLogo();
      ajStatus('aj-identidade-status', 'Logo escolhida. Clique em Salvar para aplicar. As cores sugeridas por ela estão no cartão "Cores do Site", logo abaixo.');
      sugerirCoresLogo(true);   // sugere as cores da logo nova (só vale depois de Salvar cores)
    };
    img.onerror = () => ajStatus('aj-identidade-status', 'Não consegui abrir essa imagem.', '#e05555');
    img.src = leitor.result;
  };
  leitor.readAsDataURL(arquivo);
}
function removerLogo() {
  _logoPendente = '';
  atualizarPreviewLogo();
  ajStatus('aj-identidade-status', 'A logo padrão volta ao salvar.');
}

// ── Cores do site (aba Ajustes) ──────────────────
// Guardadas em config/barbearia (campo "cores": { destaque, fundo }). Site e painel repintam a tela sozinhos
// (ver TEMA_BARBEARIA no config.js). As presets e a leitura das cores da logo também vêm de lá.
function corTemaAtual() {
  if (BARBEARIA.tema) return BARBEARIA.tema;
  const c = BARBEARIA.cores || TEMA_BARBEARIA.PALETA_PADRAO;
  return { destaque: c.destaque, fundo: c.fundo };
}
// manter = true: mantém as cores que estão nos campos (ex.: sugeridas pela logo e ainda não salvas)
function renderCoresAjuste(manter) {
  const a = document.getElementById('aj-cor-destaque');
  if (!a) return;
  if (!manter) {
    const cor = corTemaAtual();
    a.value = cor.destaque.toLowerCase();
    document.getElementById('aj-cor-fundo').value = cor.fundo.toLowerCase();
  }
  document.getElementById('aj-presets').innerHTML = TEMA_BARBEARIA.ESTILOS.map((p, i) =>
    '<button type="button" class="aj-btn2" style="display:flex;align-items:center;gap:8px;" onclick="aplicarEstiloCores(' + i + ')">' +
      '<span data-sem-tema style="display:inline-block;width:16px;height:16px;border-radius:50%;border:1px solid rgba(255,255,255,.25);margin-right:-4px;background:' + p.fundo + ';"></span>' +
      '<span data-sem-tema style="display:inline-block;width:16px;height:16px;border-radius:50%;border:1px solid rgba(255,255,255,.25);margin-right:-4px;background:' + p.destaque + ';"></span>' +
      escPlano(p.nome) + '</button>').join('');
  atualizarPreviewCores();
  if (!manter) {
    ajStatus('aj-cores-status', '');
    ajStatus('aj-cores-logo-status', 'Ao escolher uma logo nova acima, as cores são sugeridas automaticamente.');
  }
}
function atualizarPreviewCores() {
  const p = document.getElementById('aj-cores-preview');
  if (!p) return;
  const pal = TEMA_BARBEARIA.derivarPaleta(document.getElementById('aj-cor-destaque').value, document.getElementById('aj-cor-fundo').value);
  p.style.background = pal.fundo;
  p.innerHTML = '<div style="background:' + pal.cartao + ';border:1px solid ' + pal.borda + ';border-radius:8px;padding:14px;">' +
    '<div style="font:600 18px Georgia,serif;color:' + pal.texto + '">' + escPlano(BARBEARIA.marca.linha1 || 'Sua') + ' <em style="color:' + pal.destaque + '">' + escPlano(BARBEARIA.marca.linha2 || 'Studio') + '</em></div>' +
    '<div style="font:12px Arial;color:' + pal.textoSecundario + ';margin:4px 0 10px">Corte · R$ 30,00 · 30 min</div>' +
    '<span style="display:inline-block;background:' + pal.destaque + ';color:' + pal.fundo + ';font:700 12px Arial;letter-spacing:1px;padding:8px 16px;border-radius:4px">AGENDAR</span>' +
    ' <span style="display:inline-block;border:1px solid ' + pal.bordaBotao + ';background:' + pal.botao + ';color:' + pal.texto + ';font:12px Arial;padding:8px 14px;border-radius:4px;margin-left:6px">Botão</span></div>';
}
function aplicarEstiloCores(i) {
  const e = TEMA_BARBEARIA.ESTILOS[i];
  if (!e) return;
  document.getElementById('aj-cor-destaque').value = e.destaque.toLowerCase();
  document.getElementById('aj-cor-fundo').value = e.fundo.toLowerCase();
  atualizarPreviewCores();
  ajStatus('aj-cores-status', 'Estilo escolhido. Clique em Salvar cores para aplicar.');
}
// Lê as cores da logo (a que está na tela: a nova, se você acabou de escolher, ou a atual) e sugere destaque + fundo
async function sugerirCoresLogo(automatico) {
  const st = 'aj-cores-logo-status';
  const fonte = (_logoPendente !== undefined ? _logoPendente : BARBEARIA.logo) || 'logo_emblema.png';
  ajStatus(st, 'Lendo as cores da logo...');
  try {
    const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => erro(new Error('imagem')); i.src = fonte; });
    const esc = Math.min(1, 96 / Math.max(img.width || 1, img.height || 1));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round((img.width || 1) * esc));
    cv.height = Math.max(1, Math.round((img.height || 1) * esc));
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const r = TEMA_BARBEARIA.extrairCoresDaLogo(ctx.getImageData(0, 0, cv.width, cv.height).data);
    if (!r) { ajStatus(st, 'Não consegui ler as cores dessa imagem.', '#e05555'); return; }
    document.getElementById('aj-cor-destaque').value = r.destaque.toLowerCase();
    document.getElementById('aj-cor-fundo').value = r.fundo.toLowerCase();
    atualizarPreviewCores();
    ajStatus(st, (r.vibrante ? 'Cores sugeridas pela logo. ' : 'A logo não tem uma cor marcante; usei um tom neutro. ') +
      'Veja o exemplo abaixo, ajuste se quiser e clique em Salvar cores.', '#4caf50');
  } catch (e) { ajStatus(st, 'Não consegui ler as cores dessa imagem.', '#e05555'); }
}
async function salvarCores() {
  const d = document.getElementById('aj-cor-destaque').value.toUpperCase();
  const f = document.getElementById('aj-cor-fundo').value.toUpperCase();
  if (!TEMA_BARBEARIA.ehHex(d) || !TEMA_BARBEARIA.ehHex(f)) { ajStatus('aj-cores-status', 'Escolha as duas cores.', '#e05555'); return; }
  ajStatus('aj-cores-status', 'Salvando...');
  try {
    await db.collection('config').doc('barbearia').set({ cores: { destaque: d, fundo: f }, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await carregarAjustesRemotos();          // guarda no aparelho e repinta site e painel na hora
    renderCoresAjuste();
    ajStatus('aj-cores-status', 'Cores salvas! O site e o painel já usam as novas cores.', '#4caf50');
    showToast('Cores atualizadas.');
  } catch (e) {
    console.warn(e);
    ajStatus('aj-cores-status', 'Erro ao salvar: ' + (e.message || e.code || e), '#e05555');
  }
}
async function restaurarCoresOriginais() {
  ajStatus('aj-cores-status', 'Restaurando...');
  try {
    await db.collection('config').doc('barbearia').set({ cores: firebase.firestore.FieldValue.delete(), atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await carregarAjustesRemotos();
    renderCoresAjuste();
    ajStatus('aj-cores-status', 'Voltou às cores originais.', '#4caf50');
    showToast('Cores originais restauradas.');
  } catch (e) {
    console.warn(e);
    ajStatus('aj-cores-status', 'Erro ao restaurar: ' + (e.message || e.code || e), '#e05555');
  }
}

// ── Letra do nome no topo (aba Ajustes) ──────────────────────────
// Os estilos prontos ficam em FONTES_TOPO (config.js). A escolha vai para config/barbearia (campo "fonte")
// e o site aplica na hora de abrir (ver aplicarFonteTopo no config.js).
let _fonteEdit = 'classico';   // estilo marcado na tela (só vale depois de Salvar letra)
let _fontesPreviaOk = false;
function renderFontesAjuste() {
  const el = document.getElementById('aj-fontes');
  if (!el) return;
  if (!_fontesPreviaOk) { _fontesPreviaOk = true; carregarFontesGoogle(FONTES_TOPO_TODAS, 'fontes-previa-css'); }   // baixa as fontes só para a prévia
  const t1 = BARBEARIA.marca.linha1 || 'Sua', t2 = BARBEARIA.marca.linha2 || 'Studio';
  el.innerHTML = FONTES_TOPO.map(f =>
    '<button type="button" class="aj-fonte' + (f.id === _fonteEdit ? ' sel' : '') + '" onclick="escolherFonte(\'' + f.id + '\')" aria-pressed="' + (f.id === _fonteEdit) + '">' +
      '<span style="color:#F1EAD6;' + estiloLinhaFonte(f.l1, 0.42) + '">' + escPlano(t1) + '</span>' +
      '<span style="color:#C97D5C;' + estiloLinhaFonte(f.l2, 0.42) + 'margin-top:' + Math.round(parseFloat(f.l2.mt || 0) * 0.42) + 'px;">' + escPlano(t2) + '</span>' +
      '<span class="aj-fonte-nome">' + escPlano(f.nome) + (f.id === fonteTopoAtual().id ? ' · em uso' : '') + '</span>' +
    '</button>').join('');
}
function escolherFonte(id) {
  if (!FONTES_TOPO.some(f => f.id === id)) return;
  _fonteEdit = id;
  renderFontesAjuste();
  ajStatus('aj-fonte-status', id === fonteTopoAtual().id ? '' : 'Estilo escolhido. Clique em Salvar letra para aplicar.');
}
async function salvarFonte() {
  if (!FONTES_TOPO.some(f => f.id === _fonteEdit)) return;
  ajStatus('aj-fonte-status', 'Salvando...');
  try {
    await db.collection('config').doc('barbearia').set({ fonte: _fonteEdit, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await carregarAjustesRemotos();          // guarda no aparelho e já aplica o estilo escolhido
    renderFontesAjuste();
    ajStatus('aj-fonte-status', 'Letra salva! O site já usa o novo estilo.', '#4caf50');
    showToast('Letra do topo atualizada.');
  } catch (e) {
    console.warn(e);
    ajStatus('aj-fonte-status', 'Erro ao salvar: ' + (e.message || e.code || e), '#e05555');
  }
}

// ── Salvar identidade ──
async function salvarIdentidade() {
  const val = id => document.getElementById(id).value.trim();
  const nome = val('aj-nome'), linha1 = val('aj-linha1'), linha2 = val('aj-linha2'), nomeCurto = val('aj-nomecurto');
  let whats = val('aj-whatsapp').replace(/\D/g, '');
  if (!nome || !linha1) { ajStatus('aj-identidade-status', 'Informe o nome do salão e a 1ª linha do topo do site.', '#e05555'); return; }
  if (whats && (whats.length === 10 || whats.length === 11)) whats = '55' + whats;
  if (whats && !/^55\d{10,11}$/.test(whats)) { ajStatus('aj-identidade-status', 'WhatsApp: use DDD + número (ex.: 85999998888).', '#e05555'); return; }
  const dados = { nome, linha1, linha2, nomeCurto: nomeCurto || linha1, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() };
  if (whats) dados.whatsapp = whats;
  if (_logoPendente !== undefined) dados.logo = _logoPendente;
  ajStatus('aj-identidade-status', 'Salvando...');
  try {
    await db.collection('config').doc('barbearia').set(dados, { merge: true });
    await carregarAjustesRemotos();
    aplicarAjustesNoAdmin();
    renderAjustes(true);
    ajStatus('aj-identidade-status', 'Salvo! O site já usa os novos dados.', '#4caf50');
    showToast('Dados do salão atualizados.');
  } catch (e) {
    console.warn(e);
    ajStatus('aj-identidade-status', 'Erro ao salvar: ' + (e.message || e.code || e), '#e05555');
  }
}

// ── Planos ──
function renderPlanosEditor() {
  const el = document.getElementById('aj-planos-lista');
  if (!el) return;
  const ativo = document.getElementById('aj-planos-ativos').checked;
  document.getElementById('aj-planos-corpo').style.display = ativo ? '' : 'none';
  if (!_planosEdit.length) { el.innerHTML = '<p style="color:#8D7670;font-size:13px;font-family:Roboto,sans-serif;">Nenhum plano cadastrado. Clique em “Adicionar plano”.</p>'; return; }
  el.innerHTML = _planosEdit.map((p, i) => {
    const lim = p.limite || {};
    const servs = SERVICES.map(s =>
      '<label class="aj-check"><input type="checkbox" class="aj-pl-serv" value="' + escPlano(s.id) + '"' + ((p.servicosIncluidos || []).includes(s.id) ? ' checked' : '') + '> ' + escPlano(s.name) + '</label>').join('');
    return '<div class="aj-plano" data-idx="' + i + '" data-id="' + escPlano(p.id) + '">' +
      '<div class="aj-linha">' +
        '<div class="aj-campo" style="flex:2;min-width:160px;"><span class="aj-lbl">Nome do plano</span><input class="aj-in aj-pl-nome" value="' + escPlano(p.nome) + '"></div>' +
        '<div class="aj-campo" style="flex:1;min-width:110px;"><span class="aj-lbl">Valor mensal (R$)</span><input type="number" min="0" step="0.5" class="aj-in aj-pl-preco" value="' + (isNaN(p.preco) ? '' : p.preco) + '"></div>' +
      '</div>' +
      '<div class="aj-campo"><span class="aj-lbl">Benefícios (um por linha; aparecem no card do site)</span><textarea class="aj-in aj-pl-itens" rows="3">' + escPlano((p.itens || []).join('\n')) + '</textarea></div>' +
      '<div class="aj-campo"><span class="aj-lbl">Serviços que o plano cobre</span><div class="aj-checks">' + servs + '</div></div>' +
      '<div class="aj-linha">' +
        '<div class="aj-campo" style="flex:1;min-width:170px;"><span class="aj-lbl">Limite de uso</span>' +
          '<select class="aj-in aj-pl-lim-tipo"><option value="">Sem limite</option>' +
            '<option value="periodo"' + (lim.por === 'periodo' ? ' selected' : '') + '>Por mensalidade</option>' +
            '<option value="semana"' + (lim.por === 'semana' ? ' selected' : '') + '>Por semana</option>' +
            '<option value="mes"' + (lim.por === 'mes' ? ' selected' : '') + '>Por mês do calendário</option></select></div>' +
        '<div class="aj-campo" style="width:110px;"><span class="aj-lbl">Quantidade</span><input type="number" min="1" step="1" class="aj-in aj-pl-lim-qtd" value="' + (lim.qtd || 1) + '"></div>' +
      '</div>' +
      '<div class="aj-checks">' +
        '<label class="aj-check"><input type="checkbox" class="aj-pl-publico"' + (p.publico !== false ? ' checked' : '') + '> Mostrar no site</label>' +
        '<label class="aj-check"><input type="checkbox" class="aj-pl-destaque"' + (p.destaque ? ' checked' : '') + '> Destaque</label>' +
        '<input class="aj-in aj-pl-selo" placeholder="Etiqueta (ex.: MAIS ESCOLHIDO)" value="' + escPlano(p.selo || '') + '" style="max-width:220px;">' +
        '<label class="aj-check"><input type="checkbox" class="aj-pl-vitalicio"' + (p.vitalicio ? ' checked' : '') + '> Vitalício (sem vencimento)</label>' +
      '</div>' +
      '<div><button type="button" class="aj-btn2" style="color:#e05555;border-color:rgba(200,60,60,.4);" onclick="removerPlanoAjuste(' + i + ')">Remover plano</button></div>' +
    '</div>';
  }).join('');
}
function lerPlanosDoDOM() {
  return [...document.querySelectorAll('#aj-planos-lista .aj-plano')].map(row => {
    const q = s => row.querySelector(s);
    const p = {
      id: row.dataset.id,
      nome: q('.aj-pl-nome').value.trim(),
      preco: Number(String(q('.aj-pl-preco').value).replace(',', '.')),
      itens: q('.aj-pl-itens').value.split('\n').map(t => t.trim()).filter(Boolean),
      servicosIncluidos: [...row.querySelectorAll('.aj-pl-serv:checked')].map(c => c.value),
      publico: q('.aj-pl-publico').checked,
      destaque: q('.aj-pl-destaque').checked,
      vitalicio: q('.aj-pl-vitalicio').checked,
    };
    const selo = q('.aj-pl-selo').value.trim();
    if (p.destaque && selo) p.selo = selo;
    const tipo = q('.aj-pl-lim-tipo').value;
    if (tipo) p.limite = { qtd: Math.max(1, parseInt(q('.aj-pl-lim-qtd').value, 10) || 1), por: tipo };
    return p;
  });
}
function alternarPlanosAtivos() { _planosEdit = lerPlanosDoDOM(); renderPlanosEditor(); }
function adicionarPlanoAjuste() {
  _planosEdit = lerPlanosDoDOM();
  _planosEdit.push({ id: 'p' + Date.now().toString(36), nome: 'Novo plano', preco: 0, itens: [], servicosIncluidos: [], publico: true });
  renderPlanosEditor();
  const linhas = document.querySelectorAll('#aj-planos-lista .aj-plano');
  if (linhas.length) linhas[linhas.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function removerPlanoAjuste(i) {
  _planosEdit = lerPlanosDoDOM();
  const p = _planosEdit[i];
  if (!p) return;
  try {
    const usados = await db.collection('clientes').where('plano', '==', p.id).limit(1).get();
    if (!usados.empty) {
      alert('Ainda existem clientes neste plano. Para não perder o histórico, desmarque "Mostrar no site" em vez de remover.');
      renderPlanosEditor();
      return;
    }
  } catch (e) { console.warn(e); }
  if (!confirm('Remover o plano "' + (p.nome || 'sem nome') + '"? Só vale depois de clicar em Salvar planos.')) { renderPlanosEditor(); return; }
  _planosEdit.splice(i, 1);
  renderPlanosEditor();
}
async function salvarPlanos() {
  const ativos = document.getElementById('aj-planos-ativos').checked;
  const lista = lerPlanosDoDOM();
  if (ativos) {
    if (!lista.length) { ajStatus('aj-planos-status', 'Adicione pelo menos um plano ou desative os planos.', '#e05555'); return; }
    for (const p of lista) {
      if (!p.nome) { ajStatus('aj-planos-status', 'Todo plano precisa de um nome.', '#e05555'); return; }
      if (!(p.preco >= 0)) { ajStatus('aj-planos-status', 'Valor inválido no plano "' + p.nome + '".', '#e05555'); return; }
      if (!p.servicosIncluidos.length) { ajStatus('aj-planos-status', 'Marque ao menos um serviço coberto no plano "' + p.nome + '".', '#e05555'); return; }
    }
  }
  ajStatus('aj-planos-status', 'Salvando...');
  try {
    // Com os planos desativados só guardamos o interruptor: a lista de planos fica como estava, para poder reativar depois
    const dados = { planosAtivos: ativos, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() };
    if (ativos) dados.planos = lista;
    await db.collection('config').doc('barbearia').set(dados, { merge: true });
    await carregarAjustesRemotos();
    aplicarAjustesNoAdmin();
    renderAjustes(true);
    ajStatus('aj-planos-status', 'Planos salvos! O site já mostra os novos valores.', '#4caf50');
    showToast('Planos atualizados.');
  } catch (e) {
    console.warn(e);
    ajStatus('aj-planos-status', 'Erro ao salvar: ' + (e.message || e.code || e), '#e05555');
  }
}

// Aplica no painel os ajustes (cache + Firebase): nome, logo, lista de planos e visibilidade dos planos
function aplicarAjustesNoAdmin() {
  montarPlanosAdmin();
  try { preencherOpcoesPlano(); } catch (e) {}
  aplicarMarca();
  document.body.classList.toggle('sem-planos', BARBEARIA.planosAtivos === false);
  try { renderPlanosClientes(); } catch (e) {}
}
document.addEventListener('DOMContentLoaded', () => {
  aplicarAjustesNoAdmin();
  carregarAjustesRemotos().then(mudou => { if (mudou) aplicarAjustesNoAdmin(); });
});

// Opções do seletor de plano (cadastro de plano do cliente), a partir dos planos configurados
function preencherOpcoesPlano() {
  const sel = document.getElementById('plano-tipo');
  if (!sel) return;
  sel.innerHTML = PLANOS_ADMIN.map(p =>
    '<option value="' + escPlano(p.id) + '">' + escPlano(p.nome) + ' - ' + (p.vitalicio ? 'Vitalício' : 'R$' + p.preco) + '</option>').join('');
}


// ── Galeria de fotos (aba Ajustes, seção "Fotos do Site") ──────────────────
// Guardada em config/galeria: { fotos: [dataURL, dataURL, ...] }. O site lê o mesmo
// documento no carregamento (ver carregarGaleria em app.js) e monta o carrossel "Nosso Trabalho".
async function carregarGaleria() {
  try {
    const doc = await db.collection('config').doc('galeria').get();
    if (doc.exists) {
      const dados = doc.data() || {};
      if (Array.isArray(dados.fotos)) GALERIA_FOTOS = dados.fotos.filter(Boolean);
    }
  } catch (e) { console.warn('Não foi possível carregar a galeria de fotos', e); }
  if (document.getElementById('tab-servicos') && document.getElementById('tab-servicos').classList.contains('active')) {
    _galeriaEdit = JSON.parse(JSON.stringify(GALERIA_FOTOS));
    renderGaleriaEditor();
  }
}

function renderGaleriaEditor() {
  const el = document.getElementById('aj-galeria-grid');
  if (!el) return;
  if (!_galeriaEdit.length) {
    el.innerHTML = '<p style="color:#8D7670;font-size:13px;font-family:\'Roboto\',sans-serif;grid-column:1/-1;">Nenhuma foto enviada ainda.</p>';
    ajStatus('aj-galeria-status', '');
    return;
  }
  el.innerHTML = _galeriaEdit.map((src, i) =>
    '<div style="position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;border:1px solid #68443D;background:#1E1310;">' +
      '<img src="' + src + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">' +
      '<button type="button" onclick="removerFotoGaleria(' + i + ')" title="Remover" ' +
        'style="position:absolute;top:4px;right:4px;background:rgba(8,8,8,0.75);border:1px solid rgba(200,60,60,.5);color:#e05555;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:13px;line-height:1;">✕</button>' +
    '</div>').join('');
  ajStatus('aj-galeria-status', '');
}

function removerFotoGaleria(i) {
  _galeriaEdit.splice(i, 1);
  renderGaleriaEditor();
  ajStatus('aj-galeria-status', 'Foto removida. Clique em Salvar fotos para aplicar.');
}

function escolherFotosGaleria(input) {
  const arquivos = input.files ? Array.from(input.files) : [];
  input.value = '';
  if (!arquivos.length) return;
  let pendentes = arquivos.length;
  const checar = () => { pendentes--; if (pendentes <= 0) { renderGaleriaEditor(); ajStatus('aj-galeria-status', 'Fotos escolhidas. Clique em Salvar fotos para aplicar.'); } };
  arquivos.forEach(arquivo => {
    if (!/^image\//.test(arquivo.type)) { checar(); return; }
    const leitor = new FileReader();
    leitor.onload = () => {
      const img = new Image();
      img.onload = () => {
        let url = '';
        for (const max of [1400, 1000, 700]) {
          const esc = Math.min(1, max / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(img.width * esc));
          cv.height = Math.max(1, Math.round(img.height * esc));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          url = cv.toDataURL('image/jpeg', 0.82);
          if (url.length < GALERIA_MAX_CHARS) break;
        }
        if (url.length < GALERIA_MAX_CHARS) _galeriaEdit.push(url);
        checar();
      };
      img.onerror = checar;
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}

async function salvarGaleria() {
  ajStatus('aj-galeria-status', 'Salvando...');
  try {
    await db.collection('config').doc('galeria').set({ fotos: _galeriaEdit, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() });
    GALERIA_FOTOS = _galeriaEdit.slice();
    ajStatus('aj-galeria-status', 'Fotos salvas! O site já mostra a nova galeria.', '#4caf50');
    showToast('Fotos da galeria atualizadas.');
  } catch (e) {
    console.warn(e);
    ajStatus('aj-galeria-status', 'Erro ao salvar: ' + (e.message || e.code || e), '#e05555');
  }
}

// ── Valores dos serviços ─────────────────────────
// Guardados em config/servicos (o site lê o mesmo documento):
//   precos: { corte: 30, barba: 20, ... }   duracoes: { corte: 30, ... } (minutos)   lista: [{ id, name, price, duracao }]
// ── Formas de pagamento (aba Ajustes) ─────────────
// Gravadas em config/pagamento: { formas: [{id,nome,tipo,ativo,pixChave,pixNome,pixCidade,pixQr}], atualizadoEm }
// tipo 'pix' libera os campos de chave e QR Code; qualquer outro tipo ('outro') é só um nome (Dinheiro, Cartão...).
const FORMAS_PAGAMENTO_PADRAO = [
  { id: 'dinheiro', nome: 'Dinheiro', tipo: 'outro', ativo: true },
  { id: 'cartao',   nome: 'Cartão',   tipo: 'outro', ativo: true },
  { id: 'pix',      nome: 'Pix',      tipo: 'pix',   ativo: true, pixChave: '', pixNome: '', pixCidade: '', pixQr: '' },
];
let FORMAS_PAGAMENTO = FORMAS_PAGAMENTO_PADRAO.map(f => ({ ...f }));
let _pagamentoEdit = []; // rascunho em edição na tela
const QR_MAX_CHARS = 600000;   // mesmo limite usado na logo

const PRECOS_PADRAO = {}, DURACOES_PADRAO = {};
SERVICES.forEach(s => { PRECOS_PADRAO[s.id] = s.price; DURACOES_PADRAO[s.id] = s.duracao || 30; });

function fmtPrecoServ(v) { return 'R$' + Number(v).toFixed(2).replace('.', ','); }

async function carregarPrecosServicos() {
  try {
    const doc = await db.collection('config').doc('servicos').get();
    if (doc.exists) {
      const dados = doc.data() || {};
      if (Array.isArray(dados.lista) && dados.lista.length) {
        // A lista salva no painel manda: já traz serviços adicionados, removidos e na ordem escolhida.
        SERVICES = dados.lista.filter(s => s && s.id && s.name).map(s => ({
          id: String(s.id),
          name: String(s.name),
          price: (Number(s.price) >= 0) ? Number(s.price) : 0,
          duracao: (Number(s.duracao) >= 5 && Number(s.duracao) <= 480) ? Math.round(Number(s.duracao)) : 30,
        }));
      } else {
        // Compatibilidade com dados salvos antes de existir a lista completa.
        const precos = dados.precos || {}, duracoes = dados.duracoes || {};
        SERVICES.forEach(s => {
          const v = Number(precos[s.id]);
          if (precos[s.id] != null && !isNaN(v) && v >= 0) s.price = v;
          const d = Number(duracoes[s.id]);
          if (duracoes[s.id] != null && d >= 5 && d <= 480) s.duracao = Math.round(d);
        });
      }
    }
  } catch (e) { console.warn('Não foi possível carregar os preços dos serviços', e); }
  if (document.getElementById('tab-servicos') && document.getElementById('tab-servicos').classList.contains('active')) {
    _servicosEdit = JSON.parse(JSON.stringify(SERVICES));
    renderServicosEditor();
  }
}

// Lê a lista de serviços tal como está na tela agora (preserva o que o usuário já digitou
// antes de mover, remover ou adicionar uma linha).
function lerServicosDoDOM() {
  return [...document.querySelectorAll('#servicos-lista .serv-row')].map(row => ({
    id: row.dataset.id,
    name: row.querySelector('.serv-nome').value,
    price: Number(String(row.querySelector('.serv-preco').value).replace(',', '.')) || 0,
    duracao: Math.round(Number(String(row.querySelector('.serv-dur').value).replace(',', '.'))) || 30,
  }));
}

function renderServicosEditor() {
  const el = document.getElementById('servicos-lista');
  if (!el) return;
  if (!_servicosEdit.length) {
    el.innerHTML = '<p style="color:#8D7670;font-size:13px;font-family:\'Roboto\',sans-serif;">Nenhum serviço cadastrado. Clique em “Adicionar serviço”.</p>';
    document.getElementById('servicos-status').textContent = '';
    return;
  }
  el.innerHTML = _servicosEdit.map((s, i) => {
    const temPadrao = PRECOS_PADRAO[s.id] != null;
    const mudou = temPadrao && (Math.abs(s.price - PRECOS_PADRAO[s.id]) > 0.004 || (s.duracao || 30) !== DURACOES_PADRAO[s.id]);
    return '<div class="serv-row" data-idx="' + i + '" data-id="' + escPlano(s.id) + '" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#2E1D19;border:1px solid #422A24;border-radius:6px;padding:12px 16px;">' +
      '<span class="serv-handle" tabindex="0" role="button" aria-label="Arrastar para reordenar ' + escPlano(s.name) + '" ' +
        'title="Arraste para reordenar (ou use as setas do teclado)" ' +
        'onpointerdown="iniciarArrastoServico(event,' + i + ')" onkeydown="teclaArrastoServico(event,' + i + ')" ' +
        'style="cursor:grab;touch-action:none;color:#8D7670;display:flex;align-items:center;padding:4px 8px;border-radius:4px;flex-shrink:0;outline:none;">' +
        '<svg width="14" height="20" viewBox="0 0 14 20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
          '<circle cx="4" cy="3" r="1.6" fill="currentColor"/><circle cx="10" cy="3" r="1.6" fill="currentColor"/>' +
          '<circle cx="4" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/>' +
          '<circle cx="4" cy="17" r="1.6" fill="currentColor"/><circle cx="10" cy="17" r="1.6" fill="currentColor"/>' +
        '</svg>' +
      '</span>' +
      '<div style="flex:1;min-width:160px;">' +
        '<input class="aj-in serv-nome" value="' + escPlano(s.name) + '" placeholder="Nome do serviço" ' +
          'style="width:100%;background:#38231F;border:1px solid #68443D;border-radius:6px;padding:8px 10px;color:#F1EAD6;font-family:\'Oswald\',sans-serif;font-size:14px;letter-spacing:.5px;outline:none;margin-bottom:4px;box-sizing:border-box;">' +
        '<div style="font-family:\'Roboto\',sans-serif;font-size:11px;color:#8D7670;">' +
          (temPadrao
            ? ('Padrão: ' + fmtPrecoServ(PRECOS_PADRAO[s.id]) + ' · ' + DURACOES_PADRAO[s.id] + ' min' + (mudou ? ' · <span style="color:#C97D5C;">alterado</span>' : ''))
            : '<span style="color:#5BA6E0;">Serviço adicionado no painel</span>') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
        '<span style="font-family:\'Roboto\',sans-serif;font-size:13px;color:#A28A84;">R$</span>' +
        '<input type="number" min="0" step="0.5" class="serv-preco" value="' + Number(s.price).toFixed(2) + '" ' +
          'style="width:100px;background:#38231F;border:1px solid #68443D;border-radius:6px;padding:9px 10px;color:#F1EAD6;font-family:\'Roboto\',sans-serif;font-size:15px;outline:none;"/>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;" title="Tempo que o serviço ocupa na agenda">' +
        '<input type="number" min="5" max="480" step="5" class="serv-dur" value="' + (s.duracao || 30) + '" ' +
          'style="width:76px;background:#38231F;border:1px solid #68443D;border-radius:6px;padding:9px 10px;color:#F1EAD6;font-family:\'Roboto\',sans-serif;font-size:15px;outline:none;"/>' +
        '<span style="font-family:\'Roboto\',sans-serif;font-size:13px;color:#A28A84;">min</span>' +
      '</div>' +
      '<button type="button" onclick="removerServico(' + i + ')" title="Remover serviço" ' +
        'style="background:transparent;border:1px solid rgba(200,60,60,.4);color:#e05555;width:34px;height:34px;border-radius:6px;cursor:pointer;font-size:15px;line-height:1;flex-shrink:0;">✕</button>' +
    '</div>';
  }).join('');
  document.getElementById('servicos-status').textContent = '';
}

// ── Arrastar para reordenar os serviços (mouse e toque, via Pointer Events) ──
let _servDrag = null;

function iniciarArrastoServico(e, i) {
  if (e.pointerType === 'mouse' && e.button !== 0) return; // só o botão esquerdo do mouse
  e.preventDefault();
  _servicosEdit = lerServicosDoDOM();
  const lista = document.getElementById('servicos-lista');
  const linhas = [...lista.querySelectorAll('.serv-row')];
  const row = linhas[i];
  if (!row) return;
  const rect = row.getBoundingClientRect();

  const placeholder = document.createElement('div');
  placeholder.className = 'serv-placeholder';
  placeholder.style.cssText = 'height:' + rect.height + 'px;border:2px dashed #80544C;border-radius:6px;background:rgba(128, 84, 76,.12);box-sizing:border-box;margin:0;';
  row.parentNode.insertBefore(placeholder, row);

  row.style.position = 'fixed';
  row.style.left = rect.left + 'px';
  row.style.top = rect.top + 'px';
  row.style.width = rect.width + 'px';
  row.style.zIndex = '999';
  row.style.boxShadow = '0 10px 28px rgba(0,0,0,.45)';
  row.style.pointerEvents = 'none';
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'grabbing';

  const handle = e.currentTarget;
  _servDrag = { row, placeholder, offsetY: e.clientY - rect.top, handle };
  try { handle.setPointerCapture(e.pointerId); } catch (err) {}
  handle.addEventListener('pointermove', moverArrastoServico);
  handle.addEventListener('pointerup', soltarArrastoServico, { once: true });
  handle.addEventListener('pointercancel', soltarArrastoServico, { once: true });
}

function moverArrastoServico(e) {
  if (!_servDrag) return;
  const { row, placeholder, offsetY } = _servDrag;
  row.style.top = (e.clientY - offsetY) + 'px';

  const lista = document.getElementById('servicos-lista');
  const irmaos = [...lista.children].filter(el => el !== row && el !== placeholder && el.classList.contains('serv-row'));
  let inserido = false;
  for (const el of irmaos) {
    const r = el.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { lista.insertBefore(placeholder, el); inserido = true; break; }
  }
  if (!inserido) lista.appendChild(placeholder);
}

function soltarArrastoServico(e) {
  if (!_servDrag) return;
  const { row, placeholder, handle } = _servDrag;
  handle.removeEventListener('pointermove', moverArrastoServico);
  try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
  placeholder.parentNode.insertBefore(row, placeholder);
  placeholder.remove();
  row.style.position = '';
  row.style.left = '';
  row.style.top = '';
  row.style.width = '';
  row.style.zIndex = '';
  row.style.boxShadow = '';
  row.style.pointerEvents = '';
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
  _servDrag = null;
  _servicosEdit = lerServicosDoDOM();
  renderServicosEditor();
}

// Acessibilidade: com o foco na alcinha, as setas ↑ ↓ do teclado também reordenam
function teclaArrastoServico(e, i) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  _servicosEdit = lerServicosDoDOM();
  const j = i + (e.key === 'ArrowUp' ? -1 : 1);
  if (j < 0 || j >= _servicosEdit.length) return;
  [_servicosEdit[i], _servicosEdit[j]] = [_servicosEdit[j], _servicosEdit[i]];
  renderServicosEditor();
  const alcas = document.querySelectorAll('#servicos-lista .serv-handle');
  if (alcas[j]) alcas[j].focus();
}

function removerServico(i) {
  _servicosEdit = lerServicosDoDOM();
  const s = _servicosEdit[i];
  if (!s) return;
  if (!confirm('Remover o serviço "' + (s.name || 'sem nome') + '"? Agendamentos já feitos não são afetados. Só vale depois de clicar em Salvar.')) return;
  _servicosEdit.splice(i, 1);
  renderServicosEditor();
}

function adicionarServico() {
  _servicosEdit = lerServicosDoDOM();
  _servicosEdit.push({ id: 'srv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: 'Novo serviço', price: 0, duracao: 30 });
  renderServicosEditor();
  const linhas = document.querySelectorAll('#servicos-lista .serv-row');
  if (linhas.length) linhas[linhas.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  const ultimoNome = document.querySelector('#servicos-lista .serv-row:last-child .serv-nome');
  if (ultimoNome) { ultimoNome.focus(); ultimoNome.select(); }
}

function restaurarPrecosPadrao() {
  document.querySelectorAll('#servicos-lista .serv-row').forEach(row => {
    const id = row.dataset.id;
    if (PRECOS_PADRAO[id] == null) return; // serviço adicionado no painel não tem valor padrão
    row.querySelector('.serv-preco').value = Number(PRECOS_PADRAO[id]).toFixed(2);
    row.querySelector('.serv-dur').value = DURACOES_PADRAO[id];
  });
  const st = document.getElementById('servicos-status');
  st.style.color = '#BDA8A4';
  st.textContent = 'Valores padrão preenchidos nos serviços originais. Clique em Salvar para aplicar.';
}

async function salvarServicos() {
  const st = document.getElementById('servicos-status');
  const btn = document.getElementById('btn-salvar-servicos');
  const linhas = [...document.querySelectorAll('#servicos-lista .serv-row')];
  if (!linhas.length) { st.style.color = '#e05555'; st.textContent = 'Adicione pelo menos um serviço.'; return; }
  let invalido = false;
  const idsVistos = {};
  const lista = linhas.map(row => {
    const nomeEl = row.querySelector('.serv-nome');
    const precoEl = row.querySelector('.serv-preco');
    const durEl = row.querySelector('.serv-dur');
    const nome = nomeEl.value.trim();
    const preco = Number(String(precoEl.value).replace(',', '.'));
    const dur = Math.round(Number(String(durEl.value).replace(',', '.')));
    let ok = true;
    if (!nome) { ok = false; nomeEl.style.borderColor = '#e05555'; } else { nomeEl.style.borderColor = '#68443D'; }
    if (precoEl.value === '' || isNaN(preco) || preco < 0) { ok = false; precoEl.style.borderColor = '#e05555'; } else { precoEl.style.borderColor = '#68443D'; }
    if (durEl.value === '' || isNaN(dur) || dur < 5 || dur > 480) { ok = false; durEl.style.borderColor = '#e05555'; } else { durEl.style.borderColor = '#68443D'; }
    if (!ok) invalido = true;
    let id = row.dataset.id || ('srv' + Date.now().toString(36));
    if (idsVistos[id]) id = id + '_' + Math.random().toString(36).slice(2, 5);
    idsVistos[id] = true;
    return { id, name: nome, price: Math.round(preco * 100) / 100, duracao: dur };
  });
  if (invalido) { st.style.color = '#e05555'; st.textContent = 'Há campos inválidos. Nome: obrigatório. Valor: zero ou mais. Tempo: de 5 a 480 minutos.'; return; }
  btn.disabled = true; st.style.color = '#BDA8A4'; st.textContent = 'Salvando...';
  try {
    const precos = {}, duracoes = {};
    lista.forEach(s => { precos[s.id] = s.price; duracoes[s.id] = s.duracao; });
    await db.collection('config').doc('servicos').set({
      precos,
      duracoes,
      lista,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    });
    SERVICES = lista.map(s => ({ ...s }));
    _servicosEdit = JSON.parse(JSON.stringify(SERVICES));
    try { renderDisponibilidade(); } catch (e) {}
    renderServicosEditor();
    st.style.color = '#4caf50'; st.textContent = 'Serviços salvos! Já valem para novos agendamentos.';
    showToast('Serviços atualizados.');
  } catch (e) {
    console.warn(e);
    st.style.color = '#e05555'; st.textContent = 'Erro ao salvar: ' + (e.message || e.code || e);
  } finally { btn.disabled = false; }
}

// ── Formas de pagamento ────────────────────────────
async function carregarFormasPagamento() {
  try {
    const doc = await db.collection('config').doc('pagamento').get();
    if (doc.exists) {
      const dados = doc.data() || {};
      if (Array.isArray(dados.formas) && dados.formas.length) {
        FORMAS_PAGAMENTO = dados.formas.map(f => ({
          id: String(f.id || ('fp' + Date.now().toString(36))),
          nome: String(f.nome || ''),
          tipo: f.tipo === 'pix' ? 'pix' : 'outro',
          ativo: f.ativo !== false,
          pixChave: f.pixChave || '',
          pixNome: f.pixNome || '',
          pixCidade: f.pixCidade || '',
          pixQr: f.pixQr || '',
        }));
      }
    }
  } catch (e) { console.warn('Não foi possível carregar as formas de pagamento', e); }
  if (document.getElementById('tab-servicos') && document.getElementById('tab-servicos').classList.contains('active')) {
    _pagamentoEdit = JSON.parse(JSON.stringify(FORMAS_PAGAMENTO));
    renderFormasPagamentoEditor();
  }
}

function renderFormasPagamentoEditor() {
  const el = document.getElementById('pagamento-lista');
  if (!el) return;
  if (!_pagamentoEdit.length) {
    el.innerHTML = '<p style="color:#8D7670;font-size:13px;font-family:\'Roboto\',sans-serif;">Nenhuma forma de pagamento cadastrada. Clique em "Adicionar forma de pagamento".</p>';
    document.getElementById('aj-pagamento-status').textContent = '';
    return;
  }
  el.innerHTML = _pagamentoEdit.map((f, i) => {
    const qrPreview = f.pixQr
      ? '<img src="' + f.pixQr + '" alt="QR Code Pix" style="width:96px;height:96px;object-fit:contain;background:#fff;border-radius:6px;padding:4px;">'
      : '<div style="width:96px;height:96px;border:1px dashed #68443D;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#8D7670;font-size:11px;text-align:center;padding:4px;">Sem QR Code</div>';
    return '<div class="pag-row" data-idx="' + i + '" style="background:#2E1D19;border:1px solid #422A24;border-radius:6px;padding:14px 16px;">' +
      '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
        '<div style="flex:1;min-width:160px;">' +
          '<input class="aj-in pag-nome" value="' + escPlano(f.nome) + '" placeholder="Ex.: Pix, Dinheiro, Cartão" ' +
            'oninput="atualizarCampoPagamento(' + i + ',\'nome\',this.value)" ' +
            'style="width:100%;background:#38231F;border:1px solid #68443D;border-radius:6px;padding:8px 10px;color:#F1EAD6;font-family:\'Oswald\',sans-serif;font-size:14px;letter-spacing:.5px;outline:none;box-sizing:border-box;">' +
        '</div>' +
        '<select class="pag-tipo" onchange="atualizarCampoPagamento(' + i + ',\'tipo\',this.value)" ' +
          'style="background:#38231F;border:1px solid #68443D;border-radius:6px;padding:9px 10px;color:#F1EAD6;font-family:\'Roboto\',sans-serif;font-size:13px;outline:none;cursor:pointer;">' +
          '<option value="outro"' + (f.tipo !== 'pix' ? ' selected' : '') + '>Comum (sem QR Code)</option>' +
          '<option value="pix"' + (f.tipo === 'pix' ? ' selected' : '') + '>Pix (com QR Code)</option>' +
        '</select>' +
        '<label class="aj-check" style="font-size:13px;color:#BDA8A4;white-space:nowrap;">' +
          '<input type="checkbox" ' + (f.ativo ? 'checked' : '') + ' onchange="atualizarCampoPagamento(' + i + ',\'ativo\',this.checked)"> Ativa' +
        '</label>' +
        '<button type="button" onclick="removerFormaPagamento(' + i + ')" title="Remover" ' +
          'style="background:transparent;border:1px solid rgba(200,60,60,.4);color:#e05555;width:34px;height:34px;border-radius:6px;cursor:pointer;font-size:15px;line-height:1;flex-shrink:0;">✕</button>' +
      '</div>' +
      (f.tipo === 'pix'
        ? '<div style="margin-top:14px;padding-top:14px;border-top:1px solid #4A302A;">' +
            '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:6px;">' +
              '<div style="flex:1;min-width:200px;">' +
                '<span class="aj-lbl">Chave Pix (copia e cola)</span>' +
                '<input class="aj-in pag-chave" value="' + escPlano(f.pixChave || '') + '" placeholder="CPF, e-mail, telefone ou chave aleatória" ' +
                  'oninput="atualizarCampoPagamento(' + i + ',\'pixChave\',this.value)" ' +
                  'style="width:100%;background:#38231F;border:1px solid #68443D;border-radius:6px;padding:8px 10px;color:#F1EAD6;font-family:\'Roboto\',sans-serif;font-size:14px;outline:none;box-sizing:border-box;margin-top:4px;">' +
                '<span style="color:#8D7670;font-size:11px;font-family:\'Roboto\',sans-serif;display:block;margin-top:4px;">Digite sem parênteses/traço. CPF: só números. Telefone: com DDD (o "+55" é colocado sozinho).</span>' +
              '</div>' +
              '<div style="flex:1;min-width:160px;">' +
                '<span class="aj-lbl">Nome do recebedor</span>' +
                '<input class="aj-in pag-pixnome" value="' + escPlano(f.pixNome || '') + '" placeholder="Ex.: JOAO DA SILVA ou nome do salão" maxlength="25" ' +
                  'oninput="atualizarCampoPagamento(' + i + ',\'pixNome\',this.value)" ' +
                  'style="width:100%;background:#38231F;border:1px solid #68443D;border-radius:6px;padding:8px 10px;color:#F1EAD6;font-family:\'Roboto\',sans-serif;font-size:14px;outline:none;box-sizing:border-box;margin-top:4px;">' +
              '</div>' +
              '<div style="flex:1;min-width:140px;">' +
                '<span class="aj-lbl">Cidade</span>' +
                '<input class="aj-in pag-pixcidade" value="' + escPlano(f.pixCidade || '') + '" placeholder="Ex.: Fortaleza" maxlength="15" ' +
                  'oninput="atualizarCampoPagamento(' + i + ',\'pixCidade\',this.value)" ' +
                  'style="width:100%;background:#38231F;border:1px solid #68443D;border-radius:6px;padding:8px 10px;color:#F1EAD6;font-family:\'Roboto\',sans-serif;font-size:14px;outline:none;box-sizing:border-box;margin-top:4px;">' +
              '</div>' +
            '</div>' +
            (f.pixChave && f.pixNome && f.pixCidade
              ? '<p style="color:#4caf50;font-size:12px;font-family:\'Roboto\',sans-serif;margin:0 0 14px;">✓ QR Code é gerado automaticamente, já com o valor de cada serviço.</p>'
              : '<p style="color:#BDA8A4;font-size:12px;font-family:\'Roboto\',sans-serif;margin:0 0 14px;">Preenchendo a chave, o nome e a cidade acima, o QR Code passa a ser gerado sozinho, sempre com o valor certo do serviço. Sem isso, vale a imagem de QR Code enviada abaixo (sem valor).</p>') +
            '<div>' +
              '<span class="aj-lbl">QR Code enviado (reserva, sem valor)</span>' +
              '<div style="display:flex;align-items:center;gap:12px;margin-top:4px;">' +
                qrPreview +
                '<div style="display:flex;flex-direction:column;gap:8px;">' +
                  '<button type="button" class="aj-btn2" onclick="document.getElementById(\'pag-qr-file-' + i + '\').click()">Escolher imagem</button>' +
                  (f.pixQr ? '<button type="button" class="aj-btn2" onclick="atualizarCampoPagamento(' + i + ',\'pixQr\',\'\')">Remover QR Code</button>' : '') +
                  '<input type="file" id="pag-qr-file-' + i + '" accept="image/*" style="display:none" onchange="escolherQrPix(this,' + i + ')">' +
                '</div>' +
              '</div>' +
              '<span style="color:#8D7670;font-size:12px;font-family:\'Roboto\',sans-serif;display:block;margin-top:6px;max-width:320px;">Tire um print do QR Code gerado no app do seu banco e envie aqui, pra usar como reserva caso não preencha os 3 campos acima.</span>' +
            '</div>' +
          '</div>'
        : '') +
    '</div>';
  }).join('');
  document.getElementById('aj-pagamento-status').textContent = '';
}

function atualizarCampoPagamento(i, campo, valor) {
  if (!_pagamentoEdit[i]) return;
  _pagamentoEdit[i][campo] = valor;
  if (campo === 'tipo') renderFormasPagamentoEditor(); // mostra/esconde os campos do Pix
}

function escolherQrPix(input, i) {
  const arquivo = input.files && input.files[0];
  input.value = '';
  if (!arquivo || !_pagamentoEdit[i]) return;
  if (!/^image\//.test(arquivo.type)) { ajStatus('aj-pagamento-status', 'Escolha um arquivo de imagem (PNG ou JPG).', '#e05555'); return; }
  const leitor = new FileReader();
  leitor.onload = () => {
    const img = new Image();
    img.onload = () => {
      let url = '';
      for (const max of [600, 450, 320]) {
        const esc = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * esc));
        cv.height = Math.max(1, Math.round(img.height * esc));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        url = cv.toDataURL('image/png');
        if (url.length < QR_MAX_CHARS) break;
      }
      if (url.length >= QR_MAX_CHARS) { ajStatus('aj-pagamento-status', 'Imagem muito pesada. Tente um print mais simples.', '#e05555'); return; }
      _pagamentoEdit[i].pixQr = url;
      renderFormasPagamentoEditor();
      ajStatus('aj-pagamento-status', 'QR Code escolhido. Clique em Salvar para aplicar.');
    };
    img.onerror = () => ajStatus('aj-pagamento-status', 'Não consegui abrir essa imagem.', '#e05555');
    img.src = leitor.result;
  };
  leitor.readAsDataURL(arquivo);
}

function removerFormaPagamento(i) {
  const f = _pagamentoEdit[i];
  if (!f) return;
  if (!confirm('Remover a forma de pagamento "' + (f.nome || 'sem nome') + '"? Só vale depois de clicar em Salvar.')) return;
  _pagamentoEdit.splice(i, 1);
  renderFormasPagamentoEditor();
}

function adicionarFormaPagamento() {
  _pagamentoEdit.push({ id: 'fp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), nome: 'Nova forma', tipo: 'outro', ativo: true, pixChave: '', pixNome: '', pixCidade: '', pixQr: '' });
  renderFormasPagamentoEditor();
  const linhas = document.querySelectorAll('#pagamento-lista .pag-row');
  if (linhas.length) linhas[linhas.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  const ultimoNome = document.querySelector('#pagamento-lista .pag-row:last-child .pag-nome');
  if (ultimoNome) { ultimoNome.focus(); ultimoNome.select(); }
}

async function salvarFormasPagamento() {
  const st = document.getElementById('aj-pagamento-status');
  if (!_pagamentoEdit.length) { st.style.color = '#e05555'; st.textContent = 'Adicione pelo menos uma forma de pagamento.'; return; }
  let invalido = false;
  const idsVistos = {};
  const linhas = [...document.querySelectorAll('#pagamento-lista .pag-row')];
  linhas.forEach((row, i) => {
    const nomeEl = row.querySelector('.pag-nome');
    if (!nomeEl.value.trim()) { invalido = true; nomeEl.style.borderColor = '#e05555'; } else { nomeEl.style.borderColor = '#68443D'; }
  });
  if (invalido) { st.style.color = '#e05555'; st.textContent = 'Toda forma de pagamento precisa de um nome.'; return; }
  const formas = _pagamentoEdit.map(f => {
    let id = f.id || ('fp' + Date.now().toString(36));
    if (idsVistos[id]) id = id + '_' + Math.random().toString(36).slice(2, 5);
    idsVistos[id] = true;
    const out = { id, nome: f.nome.trim(), tipo: f.tipo === 'pix' ? 'pix' : 'outro', ativo: f.ativo !== false };
    if (out.tipo === 'pix') {
      out.pixChave = (f.pixChave || '').trim();
      out.pixNome = (f.pixNome || '').trim();
      out.pixCidade = (f.pixCidade || '').trim();
      out.pixQr = f.pixQr || '';
    }
    return out;
  });
  // Compara com o que estava salvo antes: se a chave Pix (ou o QR Code) de alguma forma mudou,
  // isso é sensível — é para onde o dinheiro do cliente vai — então avisamos o dono por WhatsApp.
  const alteracoesPix = [];
  formas.forEach(nova => {
    if (nova.tipo !== 'pix') return;
    const antiga = FORMAS_PAGAMENTO.find(f => f.id === nova.id);
    const chaveAntiga = antiga ? (antiga.pixChave || '') : '';
    const chaveNova = nova.pixChave || '';
    const qrAntigo = antiga ? !!antiga.pixQr : false;
    const qrNovo = !!nova.pixQr;
    if (chaveAntiga !== chaveNova || qrAntigo !== qrNovo) {
      alteracoesPix.push({ nome: nova.nome, chaveAntiga, chaveNova, qrMudou: qrAntigo !== qrNovo });
    }
  });

  st.style.color = '#BDA8A4'; st.textContent = 'Salvando...';
  try {
    await db.collection('config').doc('pagamento').set({
      formas,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    });
    FORMAS_PAGAMENTO = formas.map(f => ({ ...f }));
    _pagamentoEdit = JSON.parse(JSON.stringify(FORMAS_PAGAMENTO));
    renderFormasPagamentoEditor();
    st.style.color = '#4caf50'; st.textContent = 'Formas de pagamento salvas! Já valem para novos agendamentos.';
    showToast('Formas de pagamento atualizadas.');
    // Notificação de segurança por WhatsApp ao alterar a chave Pix: desativada a pedido.
    // Para reativar, descomente a linha abaixo.
    // if (alteracoesPix.length) avisarMudancaChavePix(alteracoesPix);
  } catch (e) {
    console.warn(e);
    st.style.color = '#e05555'; st.textContent = 'Erro ao salvar: ' + (e.message || e.code || e);
  }
}

// Alerta de segurança: sempre que a chave Pix (ou o QR Code enviado) de uma forma de pagamento
// muda, abre o WhatsApp do dono já com uma mensagem de confirmação pronta para enviar — assim,
// se o painel foi acessado por alguém sem autorização, o dono percebe na hora.
function avisarMudancaChavePix(alteracoes) {
  const numero = (BARBEARIA.whatsappAvisos || BARBEARIA.whatsapp || '').replace(/\D/g, '');
  if (!numero) return;
  const linhas = [
    '⚠️ *Alerta de Segurança — Chave Pix Alterada*', '',
    'A forma de pagamento Pix foi alterada agora no painel de ' + (BARBEARIA.nome || 'seu salão') + ':',
    '',
  ];
  alteracoes.forEach(a => {
    linhas.push('*Forma:* ' + a.nome);
    linhas.push('*Chave antiga:* ' + (a.chaveAntiga || '(vazia)'));
    linhas.push('*Chave nova:* ' + (a.chaveNova || '(vazia)'));
    if (a.qrMudou) linhas.push('*QR Code enviado:* também foi alterado');
    linhas.push('');
  });
  linhas.push('Se foi você mesmo, pode ignorar. Se não reconhece essa alteração, entre no painel agora e revise a senha de acesso.');
  window.open('https://wa.me/' + numero + '?text=' + encodeURIComponent(linhas.join('\n')), '_blank');
}

// ── Tabs ─────────────────────────────────────────
function showTab(tab, el) {
  // Injeta o tab de clientes do template na primeira vez
  if (tab === 'clientes' && !document.getElementById('tab-clientes')) {
    const tpl = document.getElementById('tpl-tab-clientes');
    const clone = tpl.content.cloneNode(true);
    document.querySelector('.admin-main').appendChild(clone);
    preencherOpcoesPlano();   // opções de plano vêm do config.js
  }
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  if (el) el.classList.add('active');
  const titles = { dashboard: 'Dashboard', agendamentos: 'Agendamentos', horarios: 'Horarios de Atendimento', servicos: 'Ajustes', datas: 'Datas Especiais', clientes: 'Clientes' };
  document.getElementById('page-title').textContent = titles[tab] || tab;
  if (tab === 'horarios') carregarHorarios();
  if (tab === 'servicos') { _servicosEdit = JSON.parse(JSON.stringify(SERVICES)); renderServicosEditor(); _pagamentoEdit = JSON.parse(JSON.stringify(FORMAS_PAGAMENTO)); renderFormasPagamentoEditor(); _galeriaEdit = JSON.parse(JSON.stringify(GALERIA_FOTOS)); renderGaleriaEditor(); renderAjustes(); }
  if (tab === 'datas') carregarDatasEspeciais();
  if (tab === 'clientes') renderClientes();
  gerenciarFab(tab);
  // Scroll para o topo no mobile
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function syncBottomNav(activeId) {
  document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(activeId);
  if (el) el.classList.add('active');
}

// ── Agendamentos ─────────────────────────────────

function loadAgendamentos() {
  unsubscribe = db.collection('agendamentos').orderBy('criadoEm', 'desc').onSnapshot(snapshot => {
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // Detecta novos agendamentos após a primeira carga
    if (_agendamentosKnownIds !== null) {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const a = { id: change.doc.id, ...change.doc.data() };
          // Só notifica se foi criado há menos de 30s (evita notificar histórico no reload)
          const criadoEm = a.criadoEm?.toDate ? a.criadoEm.toDate() : null;
          const recente = !criadoEm || (Date.now() - criadoEm.getTime() < 30000);
          if (recente) {
            notificarNovoAgendamento(a);
          }
        }
      });
    } else {
      // Primeira carga: registra IDs conhecidos
      _agendamentosKnownIds = new Set(docs.map(d => d.id));
    }

    allAgendamentos = docs;
    renderDashboard();
    renderAgendamentosTable(allAgendamentos);
  });
}

function clearDashFilter() {
  document.getElementById('dash-filter-de').value = '';
  document.getElementById('dash-filter-ate').value = '';
  renderDashboard();
}

// Retorna a data local no formato YYYY-MM-DD (sem depender de UTC)
function localDateStr(d) {
  const date = d || new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function setDashFilterToday() {
  const hoje = localDateStr();
  document.getElementById('dash-filter-de').value = hoje;
  document.getElementById('dash-filter-ate').value = hoje;
  renderDashboard();
}

function setDashFilterWeek() {
  const now = new Date();
  const day = now.getDay(); // 0=dom
  const monday = new Date(now); monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  document.getElementById('dash-filter-de').value = localDateStr(monday);
  document.getElementById('dash-filter-ate').value = localDateStr(sunday);
  renderDashboard();
}

function setDashFilterMonth() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  document.getElementById('dash-filter-de').value = localDateStr(first);
  document.getElementById('dash-filter-ate').value = localDateStr(last);
  renderDashboard();
}

// Valor mostrado nas listas: agendamentos de cliente com plano aparecem como "Plano"
function fmtValorAgd(a) {
  if (atendimentoCobertoPorPlano(a)) return 'Plano';
  const v = precoAgendamento(a);
  if (v === 0 && /^Plano /.test(a.obs || '')) return 'Plano';
  return 'R$' + v.toFixed(2).replace('.', ',');
}

// Pagamentos de planos (guardados em clientes/{tel}.planoPagamentos) entram no financeiro
function pagamentosDePlanos() {
  const out = [];
  Object.entries(_clientesFirestore).forEach(([key, c]) => {
    if (c && Array.isArray(c.planoPagamentos)) c.planoPagamentos.forEach(p => out.push({ ...p, key, nome: c.nome }));
  });
  return out;
}
function receitaDePlanos(de, ate) {
  return pagamentosDePlanos()
    .filter(p => p.data && !p.zerado && (!de || p.data >= de) && (!ate || p.data <= ate))
    .reduce((s, p) => s + (Number(p.valor) || 0), 0);
}

// ── Horários disponíveis (dashboard) ──
let _dispData = '';       // '' = hoje
let _dispCfgEstado = 0;   // 0 = não carregou, 1 = carregando, 2 = pronto
let _dispLivres = [];     // horários livres exibidos (para "Copiar livres")

function dispCarregarConfig() {
  _dispCfgEstado = 1;
  return Promise.all([
    db.collection('config').doc('horarios').get(),
    db.collection('config').doc('datas_especiais').get(),
  ]).then(([h, d]) => {
    if (h.exists) {
      const saved = h.data();
      DIAS_SEMANA.forEach(dia => { horariosConfig[dia.key] = Object.assign({}, DEFAULT_HORARIOS[dia.key], saved[dia.key] || {}); });
    }
    datasEspeciais = d.exists ? (d.data() || {}) : {};
  }).catch(() => {}).then(() => { _dispCfgEstado = 2; });
}
function dispDataAtual() { return _dispData || localDateStr(); }
function dispEscolherData(v) { _dispData = v || ''; renderDisponibilidade(); }
function dispMudarDia(delta) {
  const [y, m, d] = dispDataAtual().split('-').map(Number);
  const n = new Date(y, m - 1, d + delta);
  _dispData = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  renderDisponibilidade();
}
// Configuração do dia: data especial vale mais que o horário da semana
function dispConfigDoDia(iso) {
  const esp = datasEspeciais[iso];
  if (esp) {
    if (esp.tipo === 'fechado') return { fechado: true, motivo: esp.desc || 'Data especial (fechado)' };
    return { inicio: esp.inicio, fim: esp.fim, almoco: !!esp.almoco, almoco_inicio: esp.almoco_inicio, almoco_fim: esp.almoco_fim, especial: esp.desc || 'Data especial' };
  }
  const [y, m, d] = iso.split('-').map(Number);
  const cfg = horariosConfig[DIAS_SEMANA[new Date(y, m - 1, d).getDay()].key];
  if (!cfg || !cfg.ativo) return { fechado: true, motivo: 'Dia sem atendimento' };
  return cfg;
}
function dispNormHora(h) {
  const mt = /(\d{1,2}):(\d{2})/.exec(String(h || ''));
  return mt ? mt[1].padStart(2, '0') + ':' + mt[2] : '';
}
// Duração (min) de um agendamento, como no site: pelo serviço; serviços antigos/desconhecidos = 30
const DISP_DURACAO_PADRAO = 30;
const DISP_DURACAO_LEGADO = { 'nevou_corte': 60, 'Nevou + Corte': 60, 'Corte + Sobrancelha': 30, 'corte_sobrancelha': 30,
  'Hidratação': 30, 'Hidratacao': 30, 'hidratacao': 30 };
function dispDuracao(a) {
  const ref = a.servicoId || a.servico;
  const sv = SERVICES.find(x => x.id === ref || x.name === ref);
  return (sv && sv.duracao) || DISP_DURACAO_LEGADO[ref] || DISP_DURACAO_PADRAO;
}
function renderDisponibilidade() {
  const grid = document.getElementById('disp-grid');
  if (!grid) return;
  const resumo = document.getElementById('disp-resumo');
  const extra = document.getElementById('disp-extra');
  if (_dispCfgEstado === 0) { dispCarregarConfig().then(renderDisponibilidade); }
  if (_dispCfgEstado !== 2) { resumo.textContent = 'Carregando horários...'; return; }

  const iso = dispDataAtual();
  const inp = document.getElementById('disp-data');
  if (inp && inp.value !== iso) inp.value = iso;
  const [y, m, d] = iso.split('-').map(Number);
  const diaNome = DIAS_SEMANA[new Date(y, m - 1, d).getDay()].label;
  const rotuloDia = fmtDataBR(iso) + ' · ' + diaNome;
  _dispLivres = [];
  extra.textContent = '';

  const cfg = dispConfigDoDia(iso);
  const marcados = allAgendamentos.filter(a => a.data === iso && a.status !== 'cancelado');
  if (cfg.fechado) {
    grid.innerHTML = '';
    resumo.innerHTML = '<strong style="color:#F1EAD6;">' + escPlano(rotuloDia) + '</strong> — <span style="color:#e05555;">Fechado</span> (' + escPlano(cfg.motivo) + ')';
    return;
  }
  const temAlmoco = cfg.almoco && cfg.almoco_inicio && cfg.almoco_fim;
  const slots = gerarSlots(cfg.inicio || '08:00', cfg.fim || '18:00', !!temAlmoco, cfg.almoco_inicio || '', cfg.almoco_fim || '');

  const agora = new Date();
  const hoje = localDateStr();
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();
  const min = h => parseInt(h.slice(0, 2)) * 60 + parseInt(h.slice(3));
  const fimExp = min(dispNormHora(cfg.fim || '18:00') || '18:00');
  const pausaIni = temAlmoco ? min(dispNormHora(cfg.almoco_inicio) || '00:00') : -1;
  const pausaFim = temAlmoco ? min(dispNormHora(cfg.almoco_fim) || '00:00') : -1;
  const DUR_NOVO = DISP_DURACAO_PADRAO;   // "livre" = cabe um atendimento de 30 min (mesma regra do site)

  // Cada agendamento ocupa de horario até horario + duração do serviço
  const blocos = [];
  marcados.forEach(a => { const h = dispNormHora(a.horario); if (h) blocos.push({ ini: min(h), fim: min(h) + dispDuracao(a), h, a }); });
  const porHora = {};
  blocos.forEach(b => { (porHora[b.h] = porHora[b.h] || []).push(b.a); });

  const cardIndisp = (h, motivo) => '<div title="' + escPlano(motivo) + '" style="background:#2E1D19;border:1px solid #4A302A;border-radius:6px;padding:8px 6px;text-align:center;">' +
    '<div style="font-family:\'Oswald\',sans-serif;font-size:14px;color:#3d4d7a;text-decoration:line-through;">' + h + '</div>' +
    '<div style="font-family:\'Roboto\',sans-serif;font-size:10px;color:#3d4d7a;">' + escPlano(motivo) + '</div></div>';

  let livres = 0, ocupados = 0;
  grid.innerHTML = slots.map(h => {
    const ini = min(h);
    const cobre = blocos.filter(b => ini >= b.ini && ini < b.fim);
    if (cobre.length) {
      ocupados++;
      const comeca = cobre.filter(b => b.ini === ini);
      const principal = (comeca[0] || cobre[0]).a;
      const nome = escPlano(String(principal.cliente || '—').trim().split(' ')[0]);
      const tip = escPlano(cobre.map(b => (b.a.cliente || '—') + ' · ' + (b.a.servico || '') + ' (' + b.h + ', ' + (b.fim - b.ini) + ' min)').join('\n'));
      const sub = comeca.length ? nome + (comeca.length > 1 ? ' +' + (comeca.length - 1) : '') : nome + ' · cont.';
      return '<div title="' + tip + '" style="background:#3a2c08;border:1px solid #C97D5C;border-radius:6px;padding:8px 6px;text-align:center;' + (comeca.length ? '' : 'opacity:.75;') + '">' +
        '<div style="font-family:\'Oswald\',sans-serif;font-size:14px;color:#C97D5C;letter-spacing:.5px;">' + h + '</div>' +
        '<div style="font-family:\'Roboto\',sans-serif;font-size:10px;color:#c9a94a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + sub + '</div></div>';
    }
    // Mesmas regras do site para um horário deixar de aparecer para o cliente
    if (iso < hoje || (iso === hoje && ini <= agoraMin)) return cardIndisp(h, 'passou');
    if (ini + DUR_NOVO > fimExp) return cardIndisp(h, 'fim do expediente');
    if (temAlmoco && ini < pausaFim && ini + DUR_NOVO > pausaIni) return cardIndisp(h, 'almoço');
    if (blocos.some(b => ini < b.fim && ini + DUR_NOVO > b.ini)) return cardIndisp(h, 'não cabe');
    livres++; _dispLivres.push(h);
    return '<div style="background:#123a24;border:1px solid #1f9e54;border-radius:6px;padding:8px 6px;text-align:center;">' +
      '<div style="font-family:\'Oswald\',sans-serif;font-size:14px;color:#4cd984;letter-spacing:.5px;">' + h + '</div>' +
      '<div style="font-family:\'Roboto\',sans-serif;font-size:10px;color:#2db866;">livre</div></div>';
  }).join('');

  resumo.innerHTML = '<strong style="color:#F1EAD6;">' + escPlano(rotuloDia) + '</strong> — ' +
    '<strong style="color:#4cd984;">' + livres + ' livre' + (livres === 1 ? '' : 's') + '</strong> · ' +
    '<strong style="color:#C97D5C;">' + ocupados + ' ocupado' + (ocupados === 1 ? '' : 's') + '</strong>' +
    ' · atendimento ' + escPlano(cfg.inicio || '') + ' às ' + escPlano(cfg.fim || '') +
    (temAlmoco ? ' (almoço ' + escPlano(cfg.almoco_inicio) + '–' + escPlano(cfg.almoco_fim) + ')' : '') +
    (cfg.especial ? ' · <span style="color:#C97D5C;">' + escPlano(cfg.especial) + '</span>' : '');

  // Agendamentos marcados em horário que não está na grade (ex.: atendimento avulso ou grade alterada depois)
  const fora = Object.keys(porHora).filter(h => !slots.includes(h)).sort();
  if (fora.length) {
    extra.textContent = 'Também agendado fora da grade: ' + fora.map(h => h + ' (' + String(porHora[h][0].cliente || '—').trim().split(' ')[0] + ')').join(', ');
  }
}
function dispCopiarLivres() {
  if (!_dispLivres.length) { showToast('Não há horários livres nesse dia.'); return; }
  const iso = dispDataAtual();
  const [y, m, d] = iso.split('-').map(Number);
  const txt = 'Horários livres em ' + fmtDataBR(iso).slice(0, 5) + ' (' + DIAS_SEMANA[new Date(y, m - 1, d).getDay()].label.split('-')[0] + '): ' + _dispLivres.join(', ');
  const ok = () => showToast('Horários livres copiados.');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, () => prompt('Copie o texto:', txt));
  else prompt('Copie o texto:', txt);
}

function renderDashboard() {
  const hoje = localDateStr();
  try { renderDisponibilidade(); } catch (e) { console.warn(e); }
  const filterDe  = document.getElementById('dash-filter-de').value;
  const filterAte = document.getElementById('dash-filter-ate').value;

  // Considera filtro ativo se ao menos um campo preenchido
  const hasFilter = !!(filterDe || filterAte);
  // Efetivo: se só um lado preenchido, o outro assume o mesmo valor
  const efDe  = filterDe  || filterAte;
  const efAte = filterAte || filterDe;

  // Highlight nas bordas dos inputs quando ativos
  const styleAtivo  = 'background:#38231F;border:1px solid #C97D5C;border-radius:6px;padding:8px 12px;outline:none;color:#F1EAD6;font-family:\'Roboto\',sans-serif;font-size:13px;cursor:pointer;color-scheme:dark;';
  const styleNormal = 'background:#38231F;border:1px solid #68443D;border-radius:6px;padding:8px 12px;outline:none;color:#F1EAD6;font-family:\'Roboto\',sans-serif;font-size:13px;cursor:pointer;color-scheme:dark;';
  document.getElementById('dash-filter-de').style.cssText  = filterDe  ? styleAtivo : styleNormal;
  document.getElementById('dash-filter-ate').style.cssText = filterAte ? styleAtivo : styleNormal;

  // ── Label do filtro ──────────────────────────────
  const labelEl = document.getElementById('dash-filter-label');
  if (hasFilter) {
    const fmtDe  = efDe  ? efDe.split('-').reverse().join('/')  : '—';
    const fmtAte = efAte ? efAte.split('-').reverse().join('/') : '—';
    labelEl.textContent = efDe === efAte ? fmtDe : (fmtDe + ' — ' + fmtAte);
    labelEl.style.color = '#C97D5C';
  } else {
    labelEl.textContent = '';
  }

  // ── Filtragem por intervalo ──────────────────────
  const agendamentosNoRange = hasFilter
    ? allAgendamentos.filter(a => a.data >= efDe && a.data <= efAte)
    : [];

  // ── Cards ────────────────────────────────────────
  const isSingleDay = hasFilter && efDe === efAte;

  document.getElementById('stat-hoje').textContent = hasFilter
    ? agendamentosNoRange.length
    : allAgendamentos.filter(a => a.data === hoje).length;
  document.getElementById('stat-hoje-label').textContent = hasFilter
    ? (isSingleDay ? 'Agendamentos no Dia' : 'Agendamentos no Período')
    : 'Agendamentos Hoje';

  document.getElementById('stat-agendados').textContent = hasFilter
    ? agendamentosNoRange.filter(a => a.status === 'agendado').length
    : allAgendamentos.filter(a => a.status === 'agendado').length;
  document.getElementById('stat-agendados-label').textContent = hasFilter ? 'Agendados no Período' : 'Agendados';

  document.getElementById('stat-confirmados').textContent = hasFilter
    ? agendamentosNoRange.filter(a => a.status === 'confirmado').length
    : allAgendamentos.filter(a => a.status === 'confirmado').length;
  document.getElementById('stat-confirmados-label').textContent = hasFilter ? 'Confirmados no Período' : 'Confirmados';

  // ── Card de Receita do Período (aparece só com filtro) ──
  const cardReceitaDia = document.getElementById('stat-card-receita-dia');
  if (hasFilter) {
    const receitaServicos = agendamentosNoRange
      .filter(a => a.status === 'concluido')
      .reduce((acc, a) => acc + valorReceita(a), 0);
    const receitaPlanosPeriodo = receitaDePlanos(efDe, efAte);
    const receitaPeriodo = receitaServicos + receitaPlanosPeriodo;
    document.getElementById('stat-receita-dia').textContent = 'R$' + receitaPeriodo.toFixed(2).replace('.', ',');
    const baseLabel = isSingleDay
      ? 'Receita de ' + efDe.split('-').slice(1).reverse().join('/')
      : 'Receita do Período';
    document.getElementById('stat-receita-dia-label').textContent = receitaPlanosPeriodo > 0
      ? baseLabel + ' (inclui planos: R$' + receitaPlanosPeriodo.toFixed(2).replace('.', ',') + ')'
      : baseLabel;
    cardReceitaDia.style.display = '';
  } else {
    cardReceitaDia.style.display = 'none';
  }

  // ── Tabela ───────────────────────────────────────
  const recent = hasFilter ? agendamentosNoRange : allAgendamentos.slice(0, 8);
  const sectionTitle = document.getElementById('recent-section-title');
  if (sectionTitle) {
    sectionTitle.textContent = hasFilter
      ? (isSingleDay ? 'Agendamentos do Dia' : 'Agendamentos do Período')
      : 'Agendamentos Recentes';
  }

  const el = document.getElementById('recent-list');
  if (!recent.length) {
    el.innerHTML = '<p style="color:#8D7670;padding:20px;font-family:Oswald,sans-serif;letter-spacing:1px;">Nenhum agendamento encontrado para o período selecionado.</p>';
    return;
  }
  el.innerHTML = `<table class="admin-table">
    <thead><tr><th>Cliente</th><th>Servico</th><th>Data</th><th>Horario</th><th>Valor</th><th>Status</th></tr></thead>
    <tbody>${recent.map(a => `<tr>
      <td>${a.cliente||'--'}</td>
      <td>${a.servico||'--'}</td>
      <td>${a.data ? formatDate(a.data) : '--'}</td>
      <td>${a.horario||'--'}</td>
      <td style="color:var(--gold);font-family:var(--font-display);font-size:16px;">${fmtValorAgd(a)}</td>
      <td>${badgeHTML(a.status)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function renderAgendamentosTable(data) {
  const tbody = document.getElementById('agendamentos-body');
  if (!tbody) return;
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#8D7670;padding:32px;">Nenhum agendamento encontrado.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(a => `<tr data-id="${a.id}" ${a.origem === 'avulso' ? 'style="border-left:2px solid rgba(201, 125, 92,0.3);"' : ''}>
    <td data-label="Cliente"><strong style="color:var(--white)">${a.cliente||'--'}</strong>${a.origem==='avulso' ? ' <span style="font-family:\'Oswald\',sans-serif;font-size:8px;letter-spacing:1.5px;background:rgba(201, 125, 92,0.1);color:#C97D5C;border:1px solid rgba(201, 125, 92,0.25);padding:2px 6px;border-radius:3px;vertical-align:middle;">AVULSO</span>' : ''}</td>
    <td data-label="WhatsApp"><a href="https://wa.me/55${(a.telefone||'').replace(/\D/g,'')}" target="_blank" style="color:var(--gold);text-decoration:none;">${a.telefone||'--'}</a></td>
    <td data-label="Serviço">${a.servico||'--'}</td>
    <td data-label="Data">${a.data ? formatDate(a.data) : '--'}</td>
    <td data-label="Horário">${a.horario||'--'}</td>
    <td data-label="Pagamento">${a.formaPagamento||'--'}</td>
    <td data-label="Valor" style="color:var(--gold);font-family:var(--font-display);font-size:18px;">${fmtValorAgd(a)}</td>
    <td data-label="Status">${badgeHTML(a.status)}</td>
    <td>
      <div class="action-btns">
        ${a.status==='agendado' ? `<button class="btn-action btn-confirmar" onclick="updateStatus('${a.id}','confirmado')">Confirmar</button>` : ''}
        ${a.status==='confirmado' ? `<button class="btn-action btn-concluir" onclick="updateStatus('${a.id}','concluido')">Concluir</button>` : ''}
        ${['agendado','confirmado'].includes(a.status) ? `<button class="btn-action btn-cancelar" onclick="updateStatus('${a.id}','cancelado')">Cancelar</button>` : ''}
        <a class="btn-action btn-whats" href="https://wa.me/55${(a.telefone||'').replace(/\D/g,'')}" target="_blank">WhatsApp</a>
        <button class="btn-action btn-excluir" onclick="deleteAgendamento('${a.id}')">Excluir</button>
      </div>
    </td>
  </tr>`).join('');
}

function applyFilters() {
  const status = document.getElementById('filter-status').value;
  const date   = document.getElementById('filter-date').value;
  const search = document.getElementById('filter-search').value.toLowerCase();
  let f = allAgendamentos;
  if (status) f = f.filter(a => a.status === status);
  if (date)   f = f.filter(a => a.data === date);
  if (search) f = f.filter(a => (a.cliente||'').toLowerCase().includes(search) || (a.servico||'').toLowerCase().includes(search));
  renderAgendamentosTable(f);
}

// Mensagem enviada ao cliente (WhatsApp) para cada mudança de status
const MSG_STATUS_WPP = {
  confirmado: { titulo: 'Confirmar Agendamento',  tipo: 'de confirmação' },
  concluido:  { titulo: 'Concluir Atendimento',   tipo: 'de agradecimento' },
  cancelado:  { titulo: 'Cancelar Agendamento',   tipo: 'de cancelamento' },
};

function mensagemStatusWpp(ag, status) {
  const primeiroNome = (ag.cliente || 'Cliente').split(' ')[0];
  const detalhes = [
    '*Detalhes:*',
    '*Serviço:* ' + (ag.servico || '--'),
    '*Data:* ' + (ag.data ? formatDate(ag.data) : '--'),
    '*Horário:* ' + (ag.horario || '--'),
  ];
  if (status === 'confirmado') {
    return [
      'Olá, *' + primeiroNome + '*!', '',
      'Seu agendamento na *' + BARBEARIA.nome + '* foi *confirmado*!', '',
      ...detalhes,
      '*Valor:* R$' + (ag.preco || 0).toFixed(2).replace('.', ','), '',
      'Te esperamos! Qualquer dúvida é só chamar.',
    ].join('\n');
  }
  if (status === 'concluido') {
    return [
      'Olá, *' + primeiroNome + '*!', '',
      'Muito obrigado por escolher a *' + BARBEARIA.nome + '*! Foi um prazer te atender.', '',
      'Esperamos te ver de novo em breve. Quando quiser agendar o próximo horário, é só chamar!',
    ].join('\n');
  }
  return [
    'Olá, *' + primeiroNome + '*!', '',
    'Informamos que o seu agendamento na *' + BARBEARIA.nome + '* foi *cancelado*.', '',
    ...detalhes, '',
    'Se quiser remarcar, é só nos chamar por aqui. Qualquer dúvida, estamos à disposição!',
  ].join('\n');
}

function updateStatus(id, status) {
  const cfg = MSG_STATUS_WPP[status];
  if (cfg) {
    // Pergunta se quer avisar o cliente pelo WhatsApp (confirmar / concluir / cancelar)
    const ag = allAgendamentos.find(a => a.id === id);
    const nome = ag ? (ag.cliente || 'cliente') : 'cliente';
    document.getElementById('confirm-modal-titulo').textContent = cfg.titulo;
    document.getElementById('confirm-modal-tipo').textContent = cfg.tipo;
    document.getElementById('confirm-modal-nome').textContent = nome;
    document.getElementById('confirm-modal').style.display = 'flex';
    document.getElementById('confirm-modal-sim').onclick = function() {
      fecharConfirmModal();
      salvarStatus(id, status, true);
    };
    document.getElementById('confirm-modal-nao').onclick = function() {
      fecharConfirmModal();
      salvarStatus(id, status, false);
    };
    return;
  }
  salvarStatus(id, status, false);
}

function fecharConfirmModal() {
  document.getElementById('confirm-modal').style.display = 'none';
}

function salvarStatus(id, status, enviarWpp) {
  // Salva primeiro (a gravação já sai no clique) e só depois abre o WhatsApp.
  // O WhatsApp é aberto direto no clique do usuário: iOS Safari bloqueia window.open dentro de .then() (async).
  db.collection('agendamentos').doc(id).update({ status, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() })
    .catch(() => alert('Erro ao atualizar status.'));
  if (enviarWpp && MSG_STATUS_WPP[status]) {
    const ag = allAgendamentos.find(a => a.id === id);
    const phone = ag && ag.telefone ? ag.telefone.replace(/\D/g, '') : '';
    if (!phone) { showToast('Cliente sem WhatsApp cadastrado: mensagem não enviada.'); return; }
    const url = 'https://wa.me/55' + phone + '?text=' + encodeURIComponent(mensagemStatusWpp(ag, status));
    // Nova aba/app: o painel continua aberto e a gravação não é interrompida
    if (!window.open(url, '_blank')) window.location.href = url;
  }
}

function deleteAgendamento(id) {
  if (!confirm('Excluir este agendamento? Nao pode ser desfeito.')) return;
  db.collection('agendamentos').doc(id).delete().catch(() => alert('Erro ao excluir.'));
}

function abrirModalConcluirTodos() {
  const pendentes = allAgendamentos.filter(a => ['agendado','confirmado'].includes(a.status));
  if (!pendentes.length) {
    alert('Nenhum agendamento agendado ou confirmado para concluir.');
    return;
  }
  document.getElementById('concluir-todos-count').textContent = pendentes.length;
  document.getElementById('concluir-todos-modal').style.display = 'flex';
}

function fecharModalConcluirTodos() {
  document.getElementById('concluir-todos-modal').style.display = 'none';
}

async function confirmarConcluirTodos() {
  fecharModalConcluirTodos();
  const btn = document.querySelector('[onclick="abrirModalConcluirTodos()"]');
  const textoOriginal = btn.textContent;
  btn.textContent = 'Concluindo...';
  btn.disabled = true;

  const pendentes = allAgendamentos.filter(a => ['agendado','confirmado'].includes(a.status));
  try {
    const batch = db.batch();
    pendentes.forEach(a => {
      batch.update(db.collection('agendamentos').doc(a.id), { status: 'concluido',
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
  } catch(e) {
    alert('Erro ao concluir agendamentos: ' + (e.message || e));
  } finally {
    btn.textContent = textoOriginal;
    btn.disabled = false;
  }
}

function exportCSV() {
  const rows = [['Cliente','WhatsApp','Servico','Data','Horario','Valor (R$)','Status','Obs']];
  allAgendamentos.forEach(a => rows.push([a.cliente||'',a.telefone||'',a.servico||'',a.data||'',a.horario||'',(a.preco||0).toFixed(2).replace('.',','),a.status||'',a.obs||'']));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `agendamentos_vr_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Horários ─────────────────────────────────────



async function carregarHorarios() {
  try {
    const doc = await db.collection('config').doc('horarios').get();
    if (doc.exists) {
      const saved = doc.data();
      // Merge saved data preserving new lunch fields from DEFAULT if missing
      DIAS_SEMANA.forEach(dia => {
        horariosConfig[dia.key] = Object.assign({}, DEFAULT_HORARIOS[dia.key], saved[dia.key] || {});
      });
    }
  } catch(e) {}
  renderHorariosGrid();
}

function gerarSlots(inicio, fim, almoco, almoco_inicio, almoco_fim) {
  const slots = [];
  let [h, m] = inicio.split(':').map(Number);
  const [hf, mf] = fim.split(':').map(Number);
  const fimMin = hf * 60 + mf;
  const almocoInicioMin = almoco ? (parseInt(almoco_inicio.split(':')[0]) * 60 + parseInt(almoco_inicio.split(':')[1])) : -1;
  const almocoFimMin   = almoco ? (parseInt(almoco_fim.split(':')[0])   * 60 + parseInt(almoco_fim.split(':')[1]))   : -1;
  while (h * 60 + m < fimMin) {
    const cur = h * 60 + m;
    if (!almoco || cur < almocoInicioMin || cur >= almocoFimMin) {
      slots.push(String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0'));
    }
    m += 30; if (m >= 60) { h++; m -= 60; }
  }
  return slots;
}

function previewSlots(inicio, fim, almoco, almoco_inicio, almoco_fim) {
  const s = gerarSlots(inicio, fim, almoco, almoco_inicio, almoco_fim);
  if (!s.length) return '--';
  if (s.length <= 3) return s.join(' - ');
  return s[0] + ' - ' + s[1] + ' - ... - ' + s[s.length-1] + ' (' + s.length + ' horarios)';
}

function renderHorariosGrid() {
  const grid = document.getElementById('horarios-grid');
  if (!grid) return;
  grid.innerHTML = DIAS_SEMANA.map(dia => {
    const cfg = horariosConfig[dia.key];
    const on  = cfg.ativo;
    const alOn = cfg.almoco || false;
    return `<div style="
        background:#2E1D19; border:1px solid ${on ? '#80544C' : '#4A302A'};
        border-radius:6px; padding:16px 20px;
        display:flex; flex-direction:column; gap:14px; transition:border .2s;">

      <!-- Linha principal: toggle + horários de atendimento -->
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;min-width:170px;" onclick="toggleDia('${dia.key}')">
          <div style="width:44px;height:24px;border-radius:12px;background:${on ? '#8D7670' : '#543731'};position:relative;transition:background .2s;flex-shrink:0;">
            <div style="width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;top:3px;left:${on ? '23px' : '3px'};transition:left .2s;"></div>
          </div>
          <span style="font-family:'Oswald',sans-serif;font-size:14px;letter-spacing:1px;color:${on ? '#F1EAD6' : '#8D7670'};transition:color .2s;">${dia.label}</span>
        </label>

        <div style="display:flex;align-items:center;gap:12px;${on ? '' : 'opacity:.3;pointer-events:none;'}">
          <div style="display:flex;flex-direction:column;gap:3px;">
            <span style="font-family:'Oswald',sans-serif;font-size:10px;letter-spacing:2px;color:#A28A84;text-transform:uppercase;">Abertura</span>
            <input type="time" id="inicio-${dia.key}" value="${cfg.inicio}"
              style="background:#422A24;border:1px solid #68443D;border-radius:4px;padding:8px 12px;color:#F1EAD6;font-size:14px;outline:none;"
              onchange="updateHorario('${dia.key}')"/>
          </div>
          <span style="color:#80544C;font-size:20px;margin-top:14px;">&#8594;</span>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <span style="font-family:'Oswald',sans-serif;font-size:10px;letter-spacing:2px;color:#A28A84;text-transform:uppercase;">Fechamento</span>
            <input type="time" id="fim-${dia.key}" value="${cfg.fim}"
              style="background:#422A24;border:1px solid #68443D;border-radius:4px;padding:8px 12px;color:#F1EAD6;font-size:14px;outline:none;"
              onchange="updateHorario('${dia.key}')"/>
          </div>
        </div>

        <div style="margin-left:auto;${on ? '' : 'opacity:.3;'}">
          <span style="font-size:11px;color:#A28A84;font-family:'Oswald',sans-serif;letter-spacing:1px;">Horarios: </span>
          <span style="font-size:12px;color:#D1C3BF;font-family:'Roboto',sans-serif;" id="preview-${dia.key}">${previewSlots(cfg.inicio, cfg.fim, cfg.almoco, cfg.almoco_inicio, cfg.almoco_fim)}</span>
        </div>
      </div>

      <!-- Linha de almoço -->
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:12px 14px;border-radius:5px;background:#271915;border:1px solid ${alOn ? '#68443D' : '#422A24'};${on ? '' : 'opacity:.3;pointer-events:none;'}">
        <label style="display:flex;align-items:center;gap:9px;cursor:pointer;min-width:170px;" onclick="toggleAlmoco('${dia.key}')">
          <div style="width:36px;height:20px;border-radius:10px;background:${alOn ? '#8D7670' : '#543731'};position:relative;transition:background .2s;flex-shrink:0;">
            <div style="width:14px;height:14px;border-radius:50%;background:#fff;position:absolute;top:3px;left:${alOn ? '19px' : '3px'};transition:left .2s;"></div>
          </div>
          <span style="font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:1px;color:${alOn ? '#F1EAD6' : '#8D7670'};transition:color .2s;">Intervalo de Almoço</span>
        </label>

        <div style="display:flex;align-items:center;gap:10px;${alOn ? '' : 'opacity:.3;pointer-events:none;'}">
          <div style="display:flex;flex-direction:column;gap:3px;">
            <span style="font-family:'Oswald',sans-serif;font-size:10px;letter-spacing:2px;color:#A28A84;text-transform:uppercase;">Início pausa</span>
            <input type="time" id="almoco-inicio-${dia.key}" value="${cfg.almoco_inicio || '12:00'}"
              style="background:#38231F;border:1px solid #4A302A;border-radius:4px;padding:6px 10px;color:#F1EAD6;font-size:13px;outline:none;"
              onchange="updateHorario('${dia.key}')"/>
          </div>
          <span style="color:#80544C;font-size:16px;margin-top:14px;">&#8594;</span>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <span style="font-family:'Oswald',sans-serif;font-size:10px;letter-spacing:2px;color:#A28A84;text-transform:uppercase;">Fim pausa</span>
            <input type="time" id="almoco-fim-${dia.key}" value="${cfg.almoco_fim || '13:00'}"
              style="background:#38231F;border:1px solid #4A302A;border-radius:4px;padding:6px 10px;color:#F1EAD6;font-size:13px;outline:none;"
              onchange="updateHorario('${dia.key}')"/>
          </div>
          <span style="font-size:11px;color:#A28A84;font-family:'Roboto',sans-serif;margin-top:14px;">(bloqueado para clientes)</span>
        </div>
      </div>

    </div>`;
  }).join('');
}

function toggleDia(key) {
  horariosConfig[key].ativo = !horariosConfig[key].ativo;
  renderHorariosGrid();
}

function toggleAlmoco(key) {
  horariosConfig[key].almoco = !horariosConfig[key].almoco;
  renderHorariosGrid();
}

function updateHorario(key) {
  const inicio        = document.getElementById('inicio-' + key).value;
  const fim           = document.getElementById('fim-' + key).value;
  const almocoInicio  = document.getElementById('almoco-inicio-' + key).value;
  const almocoFim     = document.getElementById('almoco-fim-' + key).value;
  horariosConfig[key].inicio        = inicio;
  horariosConfig[key].fim           = fim;
  horariosConfig[key].almoco_inicio = almocoInicio;
  horariosConfig[key].almoco_fim    = almocoFim;
  const prev = document.getElementById('preview-' + key);
  if (prev) prev.textContent = previewSlots(inicio, fim, horariosConfig[key].almoco, almocoInicio, almocoFim);
}

async function salvarHorarios() {
  const btn = document.getElementById('btn-salvar-horarios');
  const st  = document.getElementById('horarios-status');
  btn.textContent = 'Salvando...';
  btn.disabled = true;
  try {
    await db.collection('config').doc('horarios').set({ ...horariosConfig });
    st.textContent = 'Salvo com sucesso!';
    st.style.color = '#F1EAD6';
    setTimeout(() => { st.textContent = ''; }, 3000);
  } catch(e) {
    st.textContent = 'Erro ao salvar.';
    st.style.color = '#b03030';
  }
  btn.textContent = 'Salvar Horarios';
  btn.disabled = false;
}

// ── CLIENTES ─────────────────────────────────────


async function carregarClientesFirestore() {
  try {
    const snap = await db.collection('clientes').get();
    snap.forEach(doc => { _clientesFirestore[doc.id] = doc.data(); });
    // O plano do cliente influencia o valor mostrado: redesenha as telas com os dados já carregados
    try { renderDashboard(); applyFilters(); } catch (e) {}
  } catch(e) { console.warn('Erro ao carregar clientes:', e); }
}

function buildClientMap() {
  const map = {};
  allAgendamentos.forEach(a => {
    const key = (a.telefone || '').replace(/\D/g, '') || a.cliente || 'desconhecido';
    if (!map[key]) {
      map[key] = {
        key,
        nome: a.cliente || '—',
        telefone: a.telefone || '—',
        nascimento: '',
        agendamentos: [],
      };
    }
    if (a.cliente) map[key].nome = a.cliente;
    map[key].agendamentos.push(a);
  });
  // Mescla dados do Firestore (nascimento, nome atualizado)
  Object.keys(_clientesFirestore).forEach(key => {
    const fs = _clientesFirestore[key];
    if (!map[key]) {
      map[key] = { key, nome: fs.nome || '—', telefone: fs.telefone || key, nascimento: fs.nascimento || '', agendamentos: [] };
    } else {
      if (fs.nascimento) map[key].nascimento = fs.nascimento;
      if (fs.nome) map[key].nome = fs.nome;
    }
  });
  return map;
}

function calcClientStats(agendamentos) {
  const concluidos = agendamentos.filter(a => a.status === 'concluido');
  const pagos      = concluidos.filter(a => !a.receitaZerada && !atendimentoCobertoPorPlano(a)); // fora os do plano e os já zerados
  const gastoTotal = pagos.reduce((s, a) => s + precoAgendamento(a), 0);
  const ticket     = pagos.length ? gastoTotal / pagos.length : 0;
  const servicoMap = {};
  agendamentos.forEach(a => {
    if (!a.servico) return;
    servicoMap[a.servico] = (servicoMap[a.servico] || 0) + 1;
  });
  const servicoFavorito = Object.entries(servicoMap).sort((a, b) => b[1] - a[1])[0];
  const datas = agendamentos.map(a => a.data).filter(Boolean).sort();
  const ultimaVisita = datas[datas.length - 1];
  return { concluidos: concluidos.length, pagos: pagos.length, total: agendamentos.length, gastoTotal, ticket, servicoMap, servicoFavorito, ultimaVisita };
}

function fmtNascimento(nasc) {
  if (!nasc) return '';
  const [y, m, d] = nasc.split('-');
  return d + '/' + m + '/' + y;
}

function isAniversarioAmanha(nascimento) {
  if (!nascimento) return false;
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
  const [, m, d] = nascimento.split('-');
  return parseInt(m) === (amanha.getMonth() + 1) && parseInt(d) === amanha.getDate();
}

// Mensagem de parabéns enviada ao aniversariante (WhatsApp)
function mensagemAniversario(nomeCompleto) {
  const primeiro = String(nomeCompleto || '').trim().split(' ')[0];
  return 'Olá ' + primeiro + '! Amanhã é seu aniversário e a ' + BARBEARIA.nome + ' deseja um feliz aniversário! ' +
    'Para comemorar, você ganha um serviço extra de cortesia, à sua escolha: lavagem ou sobrancelha. ' +
    'É só agendar seu horário e escolher o extra no dia do atendimento. Feliz aniversário!';
}

function renderAniversariantesBanner(clientes) {
  const banner = document.getElementById('aniversariantes-banner');
  const lista  = document.getElementById('aniversariantes-lista');
  if (!banner || !lista) return;
  const aniversariantes = clientes.filter(c => isAniversarioAmanha(c.nascimento));
  if (!aniversariantes.length) { banner.style.display = 'none'; return; }
  banner.style.display = 'block';
  lista.innerHTML = aniversariantes.map(c => {
    const tel = (c.telefone || '').replace(/\D/g, '');
    const msg = encodeURIComponent(mensagemAniversario(c.nome));
    return `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 14px;background:#201500;border:1px solid #3a2800;border-radius:6px;">
      
      <div style="flex:1;">
        <div style="font-family:'Oswald',sans-serif;font-size:14px;color:#F1EAD6;letter-spacing:1px;">${c.nome}</div>
        <div style="font-family:'Roboto',sans-serif;font-size:11px;color:#C97D5C;">Aniversário amanhã · ${fmtNascimento(c.nascimento)}</div>
      </div>
      ${tel ? `<a href="https://wa.me/55${tel}?text=${msg}" target="_blank"
        style="background:#1a2e1a;border:1px solid #2a4a2a;color:#4caf50;padding:8px 16px;border-radius:6px;font-family:'Oswald',sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;text-decoration:none;white-space:nowrap;">
        Enviar Parabens →
      </a>` : ''}
    </div>`;
  }).join('');
}

async function cadastrarClienteManual() {
  const nome  = (document.getElementById('cad-nome')?.value || '').trim();
  const tel   = (document.getElementById('cad-tel')?.value  || '').replace(/\D/g, '');
  const nasc  = (document.getElementById('cad-nasc')?.value || '').trim();
  const st    = document.getElementById('cad-status');
  if (!nome || !tel) { if(st) { st.textContent = 'Nome e telefone são obrigatórios.'; st.style.color='#b03030'; } return; }
  if(st) { st.textContent = 'Salvando...'; st.style.color = '#BDA8A4'; }
  try {
    const data = { nome, telefone: tel, criadoEm: firebase.firestore.FieldValue.serverTimestamp() };
    if (nasc) data.nascimento = nasc;
    await db.collection('clientes').doc(tel).set({ ...data }, { merge: true });
    _clientesFirestore[tel] = { ...(_clientesFirestore[tel] || {}), ...data };
    if(st) { st.textContent = 'Cliente salvo!'; st.style.color = '#4caf50'; }
    document.getElementById('cad-nome').value = '';
    document.getElementById('cad-tel').value  = '';
    document.getElementById('cad-nasc').value = '';
    setTimeout(() => { if(st) st.textContent = ''; }, 3000);
    renderClientes();
  } catch(e) {
    if(st) { st.textContent = 'Erro ao salvar.'; st.style.color = '#b03030'; }
  }
}



// ══════════════════════════════════════════════════
//  PLANOS MENSAIS
//  Guardados em clientes/{telefone}: plano, planoPagoEm, planoVenceEm
// ══════════════════════════════════════════════════
const PLANOS_ADMIN = [];   // preenchido por montarPlanosAdmin() (config.js + ajustes do painel)
// Plano vitalício: sem cobrança nem vencimento (usa uma data-limite bem distante só para os cálculos)
const VENCIMENTO_VITALICIO = '2099-12-31';
function planoVitalicio(id) { return !!planoDados(id).vitalicio; }
function vencimentoDoPlano(id, pagoISO) { return planoVitalicio(id) ? VENCIMENTO_VITALICIO : somarUmMes(pagoISO); }
function vencimentoTroca(c, novoId, modo, dataISO) {
  if (planoVitalicio(novoId)) return VENCIMENTO_VITALICIO;
  if (modo === 'manter' && !planoVitalicio(c.plano)) return c.planoVenceEm;
  return somarUmMes(dataISO);
}
function planoDados(id) { return PLANOS_ADMIN.find(p => p.id === id) || { id, nome: id || '—', preco: 0 }; }
function escPlano(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function chaveTelefone(raw) { return String(raw || '').replace(/\D/g, '').replace(/^55/, ''); }
function hojeISOAdmin() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtDataBR(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d + '/' + m + '/' + y;
}
function fmtMoedaPlano(v) { return 'R$' + Number(v).toFixed(2).replace('.', ','); }
// Mesmo dia do mês seguinte (se o mês seguinte for mais curto, usa o último dia dele)
function somarUmMes(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  let ny = y, nm = m + 1;
  if (nm > 12) { nm = 1; ny++; }
  const ultimoDia = new Date(ny, nm, 0).getDate();
  const nd = Math.min(d, ultimoDia);
  return ny + '-' + String(nm).padStart(2, '0') + '-' + String(nd).padStart(2, '0');
}
function diasEntreISO(aISO, bISO) {
  const [ay, am, ad] = aISO.split('-').map(Number);
  const [by, bm, bd] = bISO.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
}
// { tipo: 'ativo' | 'hoje' | 'vencido', dias }
function statusPlano(venceISO) {
  const dif = diasEntreISO(hojeISOAdmin(), venceISO); // >0 futuro, 0 hoje, <0 atrasado
  if (dif === 0) return { tipo: 'hoje', dias: 0 };
  if (dif < 0)   return { tipo: 'vencido', dias: -dif };
  return { tipo: 'ativo', dias: dif };
}
function mensagemCobrancaPlano(nomeCompleto, planoId, venceISO) {
  const primeiro = String(nomeCompleto || '').trim().split(' ')[0];
  const p = planoDados(planoId);
  const st = statusPlano(venceISO);
  const quando = st.tipo === 'vencido' ? 'venceu em ' + fmtDataBR(venceISO) : 'vence hoje';
  return 'Olá ' + primeiro + '! Passando para lembrar que o seu plano ' + p.nome + ' da ' + BARBEARIA.nome + ' (' +
    fmtMoedaPlano(p.preco) + '/mês) ' + quando + '. Para renovar, é só realizar o pagamento e nos avisar por aqui. Obrigado!';
}
// Atualiza a cópia local da lista de pagamentos (sem duplicar o mesmo pagamento)
function somarPagamentoLocal(cliente, pag) {
  const lista = Array.isArray(cliente && cliente.planoPagamentos) ? cliente.planoPagamentos.slice() : [];
  if (!lista.some(p => !p.encerradoEm && p.data === pag.data && p.valor === pag.valor && p.plano === pag.plano)) lista.push(pag);
  return lista;
}
// Serviços incluídos em cada plano, pelo nome gravado no agendamento (mesma regra do site)
const COBERTURA_PLANO_NOMES = {};
// Períodos de plano pagos pelo cliente: do dia do pagamento até o vencimento
function periodosDoPlano(c) {
  const ps = [];
  // Pagamentos de um plano já removido ficam no histórico, mas só cobrem atendimentos antes da remoção (encerradoEm)
  const legado = dataRemocaoPlano(c); // remoções antigas, sem data gravada no pagamento
  (Array.isArray(c.planoPagamentos) ? c.planoPagamentos : []).forEach(p => {
    if (p.data) ps.push({ plano: p.plano || c.plano, ini: p.data, fim: p.fim || somarUmMes(p.data), ate: p.encerradoEm || (!c.plano ? legado : '') });
  });
  if (c.plano && c.planoPagoEm && c.planoVenceEm && !ps.some(x => x.ini === c.planoPagoEm && !x.ate)) {
    ps.push({ plano: c.plano, ini: c.planoPagoEm, fim: c.planoVenceEm, ate: '' });
  }
  return ps;
}
// O atendimento foi feito por cliente com plano válido na data e o serviço é coberto pelo plano?
// Nesse caso ele não entra como receita (a receita é a mensalidade do plano).
// Agendamento gravado como plano na hora da reserva (preço 0 + obs "Plano ...") continua sendo plano para sempre,
// mesmo que o cliente saia do plano depois.
function agendamentoGravadoComoPlano(a) {
  return !!a && (Number(a.preco) || 0) === 0 && /^Plano /.test(a.obs || '');
}
// Limites de uso por plano (mesma regra do site): qtd de atendimentos cobertos por 'periodo' ou 'semana'
const LIMITES_PLANO_ADMIN = {};
// (Re)monta a lista de planos, o que cada um cobre e os limites de uso
function montarPlanosAdmin() {
  PLANOS_ADMIN.length = 0;
  Object.keys(COBERTURA_PLANO_NOMES).forEach(k => delete COBERTURA_PLANO_NOMES[k]);
  Object.keys(LIMITES_PLANO_ADMIN).forEach(k => delete LIMITES_PLANO_ADMIN[k]);
  BARBEARIA.planos.forEach(p => {
    PLANOS_ADMIN.push({ id: p.id, nome: p.nome, preco: Number(p.preco) || 0, vitalicio: !!p.vitalicio });
    COBERTURA_PLANO_NOMES[p.id] = (p.servicosIncluidos || []).map(id => (SERVICES.find(s => s.id === id) || {}).name).filter(Boolean);
    if (p.limite) LIMITES_PLANO_ADMIN[p.id] = p.limite;
  });
}
montarPlanosAdmin();
function semanaDeISO(dataISO) {
  const [y, m, d] = dataISO.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // segunda = 0
  const f = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  return [f(new Date(y, m - 1, d - dow)), f(new Date(y, m - 1, d - dow + 6))];
}
function mesDeISO(dataISO) {
  const [y, m] = dataISO.split('-').map(Number);
  const ult = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return [y + '-' + mm + '-01', y + '-' + mm + '-' + String(ult).padStart(2, '0')];
}
// Janela em que o limite do plano é contado (semana, mês do calendário ou período pago)
function janelaLimite(lim, dataISO, ini, fim) {
  if (lim.por === 'semana') return semanaDeISO(dataISO);
  if (lim.por === 'mes') return mesDeISO(dataISO);
  return [ini, fim];
}
function periodoCobre(p, x) {
  return x.data >= p.ini && x.data <= p.fim && (!p.ate || x.data < p.ate) &&
    (COBERTURA_PLANO_NOMES[p.plano] || []).includes(x.servico);
}
// Ordem em que o agendamento foi feito (o limite do plano vale para quem reservou primeiro, não para a data do corte)
function ordemCriacao(x) {
  const t = x && x.criadoEm;
  if (t && typeof t.toMillis === 'function') return t.toMillis();
  if (t && typeof t.seconds === 'number') return t.seconds * 1000;
  return 0; // sem data de criação (registros antigos): contam como os mais antigos
}
function gravadoComoLimiteAtingido(x) { return /^Limite do plano atingido/.test((x && x.obs) || ''); }
function atendimentoCobertoPorPlano(a) {
  if (!a || !a.data) return false;
  if (BARBEARIA.planosAtivos === false) return false;   // barbearia sem planos
  if (agendamentoGravadoComoPlano(a)) return true;
  if (gravadoComoLimiteAtingido(a)) return false; // o site já gravou como cobrado
  const c = _clientesFirestore[chaveTelefone(a.telefone)];
  if (!c) return false;
  const p = periodosDoPlano(c).find(pp => periodoCobre(pp, a));
  if (!p) return false;
  const lim = LIMITES_PLANO_ADMIN[p.plano];
  if (!lim) return true;
  // Com limite: só os primeiros atendimentos da janela (período ou semana) ficam cobertos; o resto é cobrado
  const [ini, fim] = janelaLimite(lim, a.data, p.ini, p.fim);
  const key = chaveTelefone(a.telefone);
  const doPlano = allAgendamentos
    .filter(x => x.status !== 'cancelado' && !gravadoComoLimiteAtingido(x) && chaveTelefone(x.telefone) === key &&
                 x.data >= ini && x.data <= fim && (agendamentoGravadoComoPlano(x) || periodoCobre(p, x)))
    .sort((x, y) => (ordemCriacao(x) - ordemCriacao(y)) || (x.data + (x.horario || '')).localeCompare(y.data + (y.horario || '')));
  const idx = doPlano.findIndex(x => x === a || (a.id && x.id === a.id));
  return idx < 0 ? true : idx < lim.qtd;
}
// "Usou X de Y" do plano atual do cliente (mostrado na lista de clientes com plano)
function usoPlanoHtml(c) {
  const lim = LIMITES_PLANO_ADMIN[c.plano];
  if (!lim) return '';
  const [ini, fim] = janelaLimite(lim, hojeISOAdmin(), c.planoPagoEm, c.planoVenceEm);
  const key = c.key;
  const usados = allAgendamentos.filter(x => x.status !== 'cancelado' && chaveTelefone(x.telefone) === key &&
    x.data >= ini && x.data <= fim && atendimentoCobertoPorPlano(x)).length;
  const cor = usados >= lim.qtd ? '#e0a030' : '#8D7670';
  return '<div style="font-family:Roboto,sans-serif;font-size:12px;color:' + cor + ';margin-top:2px;">Usou ' + usados + ' de ' + lim.qtd +
    (lim.por === 'semana' ? ' nesta semana' : lim.por === 'mes' ? ' neste mês' : ' neste período') + '</div>';
}
// Data em que o plano foi removido. Remoções antigas (sem data gravada) valem a partir de hoje.
function dataRemocaoPlano(c) {
  if (!c) return '';
  if (c.planoRemovidoEm) return c.planoRemovidoEm;
  if (!c.plano && Array.isArray(c.planoPagamentos) && c.planoPagamentos.length) return hojeISOAdmin();
  return '';
}
// Preço do atendimento como foi gravado no agendamento (o que era plano e o que era serviço fica memorizado ali).
function precoAgendamento(a) { return Number(a && a.preco) || 0; }
function valorReceita(a) { return (a && a.receitaZerada) || atendimentoCobertoPorPlano(a) ? 0 : precoAgendamento(a); }

function clientesComPlano() {
  return Object.entries(_clientesFirestore)
    .filter(([, c]) => c && c.plano && c.planoVenceEm)
    .map(([key, c]) => ({ key, ...c }))
    .sort((a, b) => a.planoVenceEm.localeCompare(b.planoVenceEm));
}

function renderPlanosClientes() {
  const lista = document.getElementById('planos-lista');
  const bannerLista = document.getElementById('planos-cobrar-lista');
  const banner = document.getElementById('planos-cobrar-banner');
  if (!lista) return;

  // Data padrão do formulário
  const dataEl = document.getElementById('plano-pago');
  if (dataEl && !dataEl.value) dataEl.value = hojeISOAdmin();

  // Lista de clientes cadastrados no seletor
  const sel = document.getElementById('plano-cli-select');
  if (sel) {
    const atual = sel.value;
    const opts = Object.entries(_clientesFirestore)
      .filter(([, c]) => c && c.nome)
      .sort((a, b) => a[1].nome.localeCompare(b[1].nome))
      .map(([k, c]) => '<option value="' + escPlano(k) + '">' + escPlano(c.nome) + '</option>');
    sel.innerHTML = '<option value="">Selecionar...</option>' + opts.join('');
    sel.value = atual;
  }

  const planos = clientesComPlano();
  const cnt = document.getElementById('planos-count');
  if (cnt) cnt.textContent = planos.length ? '(' + planos.length + ')' : '';

  const corStatus = { ativo: '#6dcc85', hoje: '#C97D5C', vencido: '#e05555' };
  const btnBase = "border-radius:5px;padding:7px 12px;font-family:'Oswald',sans-serif;font-size:10px;letter-spacing:1px;text-transform:uppercase;cursor:pointer;white-space:nowrap;text-decoration:none;";

  // Banner: planos vencendo hoje ou atrasados
  const cobrar = planos.filter(p => statusPlano(p.planoVenceEm).tipo !== 'ativo');
  if (banner && bannerLista) {
    if (!cobrar.length) { banner.style.display = 'none'; }
    else {
      banner.style.display = 'block';
      bannerLista.innerHTML = cobrar.map(p => {
        const st = statusPlano(p.planoVenceEm);
        const pl = planoDados(p.plano);
        const tel = chaveTelefone(p.telefone || p.key);
        const msg = encodeURIComponent(mensagemCobrancaPlano(p.nome, p.plano, p.planoVenceEm));
        const txt = st.tipo === 'hoje' ? 'Vence hoje' : 'Vencido há ' + st.dias + (st.dias === 1 ? ' dia' : ' dias');
        return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid rgba(201, 125, 92,0.15);">' +
          '<div style="flex:1;min-width:160px;">' +
            '<div style="font-family:\'Oswald\',sans-serif;font-size:14px;color:#F1EAD6;letter-spacing:.5px;">' + escPlano(p.nome) + '</div>' +
            '<div style="font-family:\'Roboto\',sans-serif;font-size:11px;color:' + corStatus[st.tipo] + ';">' + txt + ' · Plano ' + escPlano(pl.nome) + ' · ' + fmtMoedaPlano(pl.preco) + '</div>' +
          '</div>' +
          (tel ? '<a href="https://wa.me/55' + tel + '?text=' + msg + '" target="_blank" style="' + btnBase + 'background:#1a2e1a;border:1px solid #2a4a2a;color:#4caf50;">Cobrar →</a>' : '') +
          '<button onclick="registrarPagamentoPlano(\'' + escPlano(p.key) + '\')" style="' + btnBase + 'background:#C97D5C;border:1px solid #D69672;color:#1E1310;font-weight:700;">Registrar pagamento</button>' +
        '</div>';
      }).join('');
    }
  }

  // Lista completa
  if (!planos.length) {
    lista.innerHTML = '<div style="font-family:\'Roboto\',sans-serif;font-size:13px;color:#8D7670;">Nenhum cliente com plano ainda.</div>';
    return;
  }
  lista.innerHTML = planos.map(p => {
    const st = statusPlano(p.planoVenceEm);
    const pl = planoDados(p.plano);
    const rotulo = pl.vitalicio ? 'Vitalício' : st.tipo === 'ativo' ? 'Ativo' : st.tipo === 'hoje' ? 'Vence hoje' : 'Vencido há ' + st.dias + (st.dias === 1 ? ' dia' : ' dias');
    return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;background:#2E1D19;border:1px solid #422A24;border-radius:8px;">' +
      '<div style="flex:1;min-width:180px;">' +
        '<div style="font-family:\'Oswald\',sans-serif;font-size:14px;color:#F1EAD6;letter-spacing:.5px;">' + escPlano(p.nome || p.key) + '</div>' +
        '<div style="font-family:\'Roboto\',sans-serif;font-size:12px;color:#A28A84;margin-top:2px;">Plano ' + escPlano(pl.nome) + ' · ' + (pl.vitalicio ? 'Vitalício' : fmtMoedaPlano(pl.preco) + '/mês') + '</div>' +
        '<div style="font-family:\'Roboto\',sans-serif;font-size:12px;color:#8D7670;margin-top:2px;">' + (pl.vitalicio ? 'Desde ' + fmtDataBR(p.planoPagoEm) + ' · Sem vencimento' : 'Pagou em ' + fmtDataBR(p.planoPagoEm) + ' · Vence em ' + fmtDataBR(p.planoVenceEm)) + '</div>' +
        (p.planoAnterior && p.planoTrocadoEm ? '<div style=\"font-family:\'Roboto\',sans-serif;font-size:12px;color:#C97D5C;margin-top:2px;\">Trocou de ' + escPlano(planoDados(p.planoAnterior).nome) + ' para ' + escPlano(pl.nome) + ' em ' + fmtDataBR(p.planoTrocadoEm) + '</div>' : '') +
        usoPlanoHtml(p) +
      '</div>' +
      '<span style="font-family:\'Oswald\',sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:' + corStatus[st.tipo] + ';border:1px solid ' + corStatus[st.tipo] + '55;padding:4px 10px;border-radius:20px;white-space:nowrap;">' + rotulo + '</span>' +
      (pl.vitalicio ? '' : '<button onclick="registrarPagamentoPlano(\'' + escPlano(p.key) + '\')" style="' + btnBase + 'background:#543731;border:1px solid #80544C;color:#F1EAD6;">Registrar pagamento</button>') +
      '<button onclick=\"abrirTrocarPlano(\'' + escPlano(p.key) + '\')\" style=\"' + btnBase + 'background:transparent;border:1px solid #C97D5C66;color:#C97D5C;\">Trocar plano</button>' +
      '<button onclick="removerPlanoCliente(\'' + escPlano(p.key) + '\')" style="' + btnBase + 'background:transparent;border:1px solid rgba(200,60,60,0.35);color:#e05555;">Remover</button>' +
    '</div>';
  }).join('');
}

function preencherClientePlano(key) {
  const c = _clientesFirestore[key];
  if (!c) return;
  const n = document.getElementById('plano-nome');
  const t = document.getElementById('plano-tel');
  if (n) n.value = c.nome || '';
  if (t) t.value = c.telefone || key;
  if (c.plano) { const s = document.getElementById('plano-tipo'); if (s) s.value = c.plano; }
}

async function salvarPlanoCliente() {
  const nome = (document.getElementById('plano-nome')?.value || '').trim();
  const key  = chaveTelefone(document.getElementById('plano-tel')?.value);
  const plano = document.getElementById('plano-tipo')?.value || '';
  const pago  = document.getElementById('plano-pago')?.value || '';
  const st = document.getElementById('plano-status');
  const aviso = (t, cor) => { if (st) { st.textContent = t; st.style.color = cor; } };
  if (!nome || key.length < 10 || !plano || !pago) { aviso('Preencha nome, WhatsApp, plano e dia do pagamento.', '#b03030'); return; }
  aviso('Salvando...', '#BDA8A4');
  try {
    const venc = vencimentoDoPlano(plano, pago);
    const data = { nome, telefone: key, plano, planoPagoEm: pago, planoVenceEm: venc };
    if (!_clientesFirestore[key]) data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
    const pag = { data: pago, valor: planoDados(plano).preco, plano };
    if (planoVitalicio(plano)) pag.fim = venc;
    await db.collection('clientes').doc(key).set(
      { ...data, planoPagamentos: firebase.firestore.FieldValue.arrayUnion(pag) }, { merge: true });
    _clientesFirestore[key] = { ...(_clientesFirestore[key] || {}), ...data,
      planoPagamentos: somarPagamentoLocal(_clientesFirestore[key], pag) };
    try { renderDashboard(); } catch (e) {}
    aviso(planoVitalicio(plano) ? 'Plano vitalício salvo!' : 'Plano salvo! Vence em ' + fmtDataBR(venc) + '.', '#4caf50');
    ['plano-nome', 'plano-tel'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    const s = document.getElementById('plano-cli-select'); if (s) s.value = '';
    const dp = document.getElementById('plano-pago'); if (dp) dp.value = hojeISOAdmin();
    setTimeout(() => aviso('', '#8D7670'), 4000);
    renderPlanosClientes();
  } catch (e) {
    console.warn(e);
    aviso('Erro ao salvar o plano.', '#b03030');
  }
}

// Renova: pagamento hoje, vencimento no mesmo dia do mês seguinte
async function registrarPagamentoPlano(key) {
  const c = _clientesFirestore[key];
  if (!c) return;
  const pl = planoDados(c.plano);
  if (pl.vitalicio) { showToast('Plano vitalício: não tem pagamento nem vencimento.'); return; }
  if (!confirm('Registrar o pagamento de ' + (c.nome || key) + ' (' + pl.nome + ', ' + fmtMoedaPlano(pl.preco) + ') hoje?\nO novo vencimento será ' + fmtDataBR(somarUmMes(hojeISOAdmin())) + '.')) return;
  try {
    const pago = hojeISOAdmin();
    const upd = { planoPagoEm: pago, planoVenceEm: somarUmMes(pago) };
    const pag = { data: pago, valor: pl.preco, plano: c.plano };
    await db.collection('clientes').doc(key).set(
      { ...upd, planoPagamentos: firebase.firestore.FieldValue.arrayUnion(pag) }, { merge: true });
    _clientesFirestore[key] = { ..._clientesFirestore[key], ...upd,
      planoPagamentos: somarPagamentoLocal(_clientesFirestore[key], pag) };
    try { renderDashboard(); } catch (e) {}
    showToast('Pagamento registrado. Vence em ' + fmtDataBR(upd.planoVenceEm) + '.');
    renderPlanosClientes();
  } catch (e) {
    console.warn(e);
    showToast('Erro ao registrar o pagamento.');
  }
}

// ── Trocar plano (migrar o cliente para outro plano) ──
let _trocaKey = null;
let _trocaValorEditado = false;
function valorPadraoTroca(c, novoId, modo) {
  const novo = planoDados(novoId).preco, atual = planoDados(c.plano).preco;
  return modo === 'manter' ? Math.max(0, novo - atual) : novo;
}
function abrirTrocarPlano(key) {
  const c = _clientesFirestore[key];
  if (!c || !c.plano) return;
  _trocaKey = key; _trocaValorEditado = false;
  document.getElementById('troca-cliente').textContent = c.nome || key;
  document.getElementById('troca-atual').textContent = planoDados(c.plano).nome + (planoVitalicio(c.plano) ? ' · vitalício' : ' · ' + fmtMoedaPlano(planoDados(c.plano).preco) + '/mês · vence em ' + fmtDataBR(c.planoVenceEm));
  const sel = document.getElementById('troca-novo');
  sel.innerHTML = PLANOS_ADMIN.filter(pl => pl.id !== c.plano)
    .map(pl => '<option value="' + pl.id + '">' + escPlano(pl.nome) + ' - ' + (pl.vitalicio ? 'Vitalício' : fmtMoedaPlano(pl.preco)) + '</option>').join('');
  document.querySelector('input[name="troca-modo"][value="novo"]').checked = true;
  document.getElementById('troca-data').value = hojeISOAdmin();
  atualizarTrocarPlano();
  document.getElementById('troca-status').textContent = '';
  document.getElementById('troca-modal').style.display = 'flex';
}
function fecharTrocarPlano() {
  document.getElementById('troca-modal').style.display = 'none';
  _trocaKey = null;
}
function atualizarTrocarPlano(origem) {
  const c = _clientesFirestore[_trocaKey];
  if (!c) return;
  const novoId = document.getElementById('troca-novo').value;
  // Com plano vitalício (atual ou novo) não existe "manter vencimento": sempre começa um novo ciclo
  const semManter = planoVitalicio(c.plano) || planoVitalicio(novoId);
  document.querySelector('input[name="troca-modo"][value="manter"]').disabled = semManter;
  document.getElementById('troca-modo-manter').style.opacity = semManter ? '0.4' : '1';
  if (semManter) document.querySelector('input[name="troca-modo"][value="novo"]').checked = true;
  const modo = document.querySelector('input[name="troca-modo"]:checked').value;
  const dataEl = document.getElementById('troca-data');
  const valEl = document.getElementById('troca-valor');
  if (origem === 'valor') _trocaValorEditado = true;
  if (origem === 'modo' || origem === 'plano') _trocaValorEditado = false;
  if (!_trocaValorEditado) valEl.value = valorPadraoTroca(c, novoId, modo).toFixed(2);
  const data = dataEl.value || hojeISOAdmin();
  const venc = vencimentoTroca(c, novoId, modo, data);
  document.getElementById('troca-resumo').innerHTML =
    escPlano(planoDados(c.plano).nome) + ' <span style="color:#C97D5C;">→</span> <strong style="color:#F1EAD6;">' + escPlano(planoDados(novoId).nome) + '</strong>' +
    '<br>Novo vencimento: <strong style="color:#F1EAD6;">' + (planoVitalicio(novoId) ? 'Vitalício (sem vencimento)' : fmtDataBR(venc)) + '</strong>';
  document.getElementById('troca-modo-novo').style.borderColor = modo === 'novo' ? '#C97D5C' : '#68443D';
  document.getElementById('troca-modo-manter').style.borderColor = modo === 'manter' ? '#C97D5C' : '#68443D';
}
async function confirmarTrocarPlano() {
  const key = _trocaKey, c = _clientesFirestore[key];
  const st = document.getElementById('troca-status');
  const aviso = (t, cor) => { st.textContent = t; st.style.color = cor; };
  if (!c) return;
  const novoId = document.getElementById('troca-novo').value;
  const modo = document.querySelector('input[name="troca-modo"]:checked').value;
  const data = document.getElementById('troca-data').value;
  const valor = Number(String(document.getElementById('troca-valor').value).replace(',', '.'));
  if (!novoId || !data) { aviso('Escolha o novo plano e a data da troca.', '#e05555'); return; }
  if (!(valor >= 0)) { aviso('Valor inválido.', '#e05555'); return; }
  if (modo === 'manter' && data > c.planoVenceEm) { aviso('A data da troca não pode ser depois do vencimento atual.', '#e05555'); return; }
  aviso('Salvando...', '#BDA8A4');
  try {
    const venc = vencimentoTroca(c, novoId, modo, data);
    // Pagamentos em aberto do plano antigo passam a cobrir só até o dia da troca
    const lista = (Array.isArray(c.planoPagamentos) ? c.planoPagamentos : [])
      .map(x => x.encerradoEm ? x : { ...x, encerradoEm: data });
    const pag = { data, valor, plano: novoId };
    if (modo === 'manter' || planoVitalicio(novoId)) pag.fim = venc;
    lista.push(pag);
    const upd = { plano: novoId, planoPagoEm: data, planoVenceEm: venc, planoAnterior: c.plano, planoTrocadoEm: data };
    await db.collection('clientes').doc(key).set({ ...upd, planoPagamentos: lista }, { merge: true });
    _clientesFirestore[key] = { ..._clientesFirestore[key], ...upd, planoPagamentos: lista };
    fecharTrocarPlano();
    showToast('Plano trocado para ' + planoDados(novoId).nome + (planoVitalicio(novoId) ? '.' : '. Vence em ' + fmtDataBR(venc) + '.'));
    renderPlanosClientes();
    try { renderDashboard(); } catch (e) {}
    try { renderClientes(); } catch (e) {}
  } catch (e) {
    console.warn(e);
    aviso('Erro ao trocar o plano.', '#e05555');
  }
}

// ── Editar receita ──
// Lista os atendimentos concluídos e os pagamentos de plano que entram na receita,
// permite corrigir o valor de cada um ou tirá-lo da receita.
let _editRec = { itens: [], edits: {} };   // edits[id] = { valor: string, removido: bool }

function coletarItensReceita() {
  const itens = [];
  allAgendamentos.forEach(a => {
    if (a.status !== 'concluido' || a.receitaZerada || !a.id) return;
    if (atendimentoCobertoPorPlano(a)) return;        // atendimento coberto por plano não gera receita
    itens.push({ id: 'ag:' + a.id, tipo: 'ag', agId: a.id, data: a.data || '', nome: a.cliente || '—',
                 desc: a.servico || 'Atendimento', valor: precoAgendamento(a) });
  });
  Object.entries(_clientesFirestore).forEach(([key, c]) => {
    if (!c || !Array.isArray(c.planoPagamentos)) return;
    c.planoPagamentos.forEach((p, idx) => {
      if (!p || p.zerado || !p.data) return;
      itens.push({ id: 'pl:' + key + ':' + idx, tipo: 'pl', key, idx, data: p.data, nome: c.nome || key,
                   desc: 'Mensalidade · ' + planoDados(p.plano || c.plano).nome, valor: Number(p.valor) || 0 });
    });
  });
  return itens.sort((x, y) => (y.data || '').localeCompare(x.data || ''));
}
function abrirEditarReceita() {
  _editRec = { itens: coletarItensReceita(), edits: {} };
  // começa com o mesmo período do filtro do dashboard (se houver)
  document.getElementById('editrec-de').value  = document.getElementById('dash-filter-de').value  || '';
  document.getElementById('editrec-ate').value = document.getElementById('dash-filter-ate').value || '';
  document.getElementById('editrec-busca').value = '';
  document.getElementById('editrec-status').textContent = '';
  renderEditarReceita();
  document.getElementById('editrec-modal').style.display = 'flex';
}
function fecharEditarReceita() { document.getElementById('editrec-modal').style.display = 'none'; }
function editRecValorAtual(it) {
  const e = _editRec.edits[it.id];
  if (!e) return it.valor;
  if (e.removido) return 0;
  const v = Number(String(e.valor).replace(',', '.'));
  return isNaN(v) || v < 0 ? it.valor : v;
}
function editRecItensVisiveis() {
  const de = document.getElementById('editrec-de').value;
  const ate = document.getElementById('editrec-ate').value;
  const q = (document.getElementById('editrec-busca').value || '').toLowerCase().trim();
  return _editRec.itens.filter(it =>
    (!de || it.data >= de) && (!ate || it.data <= ate) && (!q || String(it.nome).toLowerCase().includes(q)));
}
function renderEditarReceita() {
  const lista = document.getElementById('editrec-lista');
  const vis = editRecItensVisiveis();
  if (!vis.length) {
    lista.innerHTML = '<p style="color:#8D7670;font-family:Oswald,sans-serif;font-size:13px;letter-spacing:1px;padding:16px 0;">Nenhum lançamento de receita neste período.</p>';
    atualizarResumoEditarReceita();
    return;
  }
  lista.innerHTML = vis.map(it => {
    const e = _editRec.edits[it.id] || {};
    const rem = !!e.removido;
    const val = e.valor != null ? e.valor : it.valor.toFixed(2);
    const idAttr = escPlano(it.id);
    return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#271915;border:1px solid ' + (rem ? '#5a2020' : '#422A24') + ';border-radius:6px;padding:9px 12px;opacity:' + (rem ? '.55' : '1') + ';">' +
      '<div style="flex:1;min-width:150px;">' +
        '<div style="font-family:\'Oswald\',sans-serif;font-size:13px;color:#F1EAD6;letter-spacing:.5px;' + (rem ? 'text-decoration:line-through;' : '') + '">' + escPlano(it.nome) + '</div>' +
        '<div style="font-family:\'Roboto\',sans-serif;font-size:11px;color:#A28A84;">' + (it.data ? fmtDataBR(it.data) : '--') + ' · ' + escPlano(it.desc) + '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
        '<span style="font-family:\'Roboto\',sans-serif;font-size:12px;color:#8D7670;">R$</span>' +
        '<input type="number" min="0" step="0.01" value="' + escPlano(val) + '" ' + (rem ? 'disabled ' : '') + 'oninput="editRecMudou(\'' + idAttr + '\', this.value)" ' +
          'style="width:88px;background:#38231F;border:1px solid #68443D;border-radius:6px;padding:7px 8px;color:#F1EAD6;font-family:\'Roboto\',sans-serif;font-size:14px;outline:none;"/>' +
        '<button onclick="editRecAlternarRemover(\'' + idAttr + '\')" title="' + (rem ? 'Voltar para a receita' : 'Tirar da receita') + '" style="width:32px;height:32px;border-radius:6px;cursor:pointer;background:' + (rem ? '#543731' : 'transparent') + ';border:1px solid ' + (rem ? '#80544C' : 'rgba(200,60,60,0.4)') + ';color:' + (rem ? '#F1EAD6' : '#e05555') + ';font-size:13px;">' + (rem ? '↩' : '✕') + '</button>' +
      '</div></div>';
  }).join('');
  atualizarResumoEditarReceita();
}
function editRecMudou(id, v) {
  const e = _editRec.edits[id] = _editRec.edits[id] || {};
  e.valor = v;
  atualizarResumoEditarReceita();
}
function editRecAlternarRemover(id) {
  const it = _editRec.itens.find(x => x.id === id);
  const e = _editRec.edits[id] = _editRec.edits[id] || { valor: it ? it.valor.toFixed(2) : '0' };
  e.removido = !e.removido;
  renderEditarReceita();
}
function atualizarResumoEditarReceita() {
  const vis = editRecItensVisiveis();
  const antes = vis.reduce((s, it) => s + it.valor, 0);
  const depois = vis.reduce((s, it) => s + editRecValorAtual(it), 0);
  const mudou = Object.keys(_editRec.edits).length;
  document.getElementById('editrec-resumo').innerHTML =
    vis.length + ' lançamento' + (vis.length === 1 ? '' : 's') + ' · Total listado: <strong style="color:#F1EAD6;">' + fmtMoedaPlano(antes) + '</strong>' +
    (Math.abs(depois - antes) > 0.004 ? ' → <strong style="color:#C97D5C;">' + fmtMoedaPlano(depois) + '</strong>' : '') +
    (mudou ? ' · <span style="color:#C97D5C;">' + mudou + ' alterado' + (mudou === 1 ? '' : 's') + '</span>' : '');
}
async function salvarEditarReceita() {
  const st = document.getElementById('editrec-status');
  const btn = document.getElementById('editrec-salvar');
  const ops = [];
  const clientes = {};   // key -> nova lista de pagamentos
  let invalido = false;
  _editRec.itens.forEach(it => {
    const e = _editRec.edits[it.id];
    if (!e) return;
    const novo = Number(String(e.valor).replace(',', '.'));
    if (!e.removido && (isNaN(novo) || novo < 0)) { invalido = true; return; }
    if (!e.removido && Math.abs(novo - it.valor) < 0.004) return;   // nada mudou
    if (it.tipo === 'ag') {
      ops.push({ ref: db.collection('agendamentos').doc(it.agId), data: e.removido ? { receitaZerada: true } : { preco: novo }, ag: it.agId, removido: !!e.removido, novo });
    } else {
      const c = _clientesFirestore[it.key];
      if (!c || !Array.isArray(c.planoPagamentos)) return;
      const lista = clientes[it.key] || (clientes[it.key] = c.planoPagamentos.map(p => ({ ...p })));
      const p = lista[it.idx];
      if (!p || p.data !== it.data || (Number(p.valor) || 0) !== it.valor) return;   // mudou por outro lado: ignora
      if (e.removido) p.zerado = true; else p.valor = novo;
    }
  });
  if (invalido) { st.style.color = '#e05555'; st.textContent = 'Há valores inválidos. Use números maiores ou iguais a zero.'; return; }
  const agOps = ops;
  const clOps = Object.entries(clientes).map(([key, lista]) => ({ ref: db.collection('clientes').doc(key), data: { planoPagamentos: lista }, key, lista }));
  if (!agOps.length && !clOps.length) { st.style.color = '#BDA8A4'; st.textContent = 'Nenhuma alteração para salvar.'; return; }
  btn.disabled = true; st.style.color = '#BDA8A4'; st.textContent = 'Salvando...';
  try {
    const todos = [...agOps, ...clOps];
    for (let i = 0; i < todos.length; i += 400) {
      const batch = db.batch();
      todos.slice(i, i + 400).forEach(o => batch.update(o.ref, o.data));
      await batch.commit();
    }
    agOps.forEach(o => {
      const a = allAgendamentos.find(x => x.id === o.ag);
      if (a) { if (o.removido) a.receitaZerada = true; else a.preco = o.novo; }
    });
    clOps.forEach(o => { if (_clientesFirestore[o.key]) _clientesFirestore[o.key].planoPagamentos = o.lista; });
    fecharEditarReceita();
    showToast('Receita atualizada (' + todos.length + ' lançamento' + (todos.length === 1 ? '' : 's') + ').');
    try { renderDashboard(); } catch (e) {}
    try { renderClientes(); } catch (e) {}
  } catch (e) {
    console.warn(e);
    st.style.color = '#e05555'; st.textContent = 'Erro ao salvar: ' + (e.message || e.code || e);
  } finally { btn.disabled = false; }
}

// ── Zerar receitas ──
// Marca os atendimentos concluídos (receitaZerada) e os pagamentos de plano (zerado) como já "descontados".
// Nada é apagado: só deixa de entrar na soma de receita.
function receitaAtualTotal() {
  const serv = allAgendamentos.filter(a => a.status === 'concluido' && !a.receitaZerada).reduce((s, a) => s + valorReceita(a), 0);
  return serv + receitaDePlanos('', '');
}
function abrirZerarReceitas() {
  document.getElementById('zerar-receitas-valor').textContent = fmtMoedaPlano(receitaAtualTotal());
  document.getElementById('zerar-receitas-input').value = '';
  document.getElementById('zerar-receitas-status').textContent = '';
  validarZerarReceitas();
  document.getElementById('zerar-receitas-modal').style.display = 'flex';
}
function fecharZerarReceitas() { document.getElementById('zerar-receitas-modal').style.display = 'none'; }
function validarZerarReceitas() {
  const ok = (document.getElementById('zerar-receitas-input').value || '').trim().toUpperCase() === 'ZERAR';
  const btn = document.getElementById('zerar-receitas-confirmar');
  btn.disabled = !ok;
  btn.style.background  = ok ? 'rgba(176,48,48,0.2)' : 'rgba(176,48,48,0.08)';
  btn.style.borderColor = ok ? 'rgba(176,48,48,0.6)' : 'rgba(176,48,48,0.2)';
  btn.style.color       = ok ? '#d45a5a' : '#A28A84';
  btn.style.cursor      = ok ? 'pointer' : 'not-allowed';
}
async function confirmarZerarReceitas() {
  const st = document.getElementById('zerar-receitas-status');
  const btn = document.getElementById('zerar-receitas-confirmar');
  btn.disabled = true; st.style.color = '#BDA8A4'; st.textContent = 'Zerando...';
  try {
    const ops = [];
    allAgendamentos.filter(a => a.status === 'concluido' && !a.receitaZerada && a.id)
      .forEach(a => ops.push({ ref: db.collection('agendamentos').doc(a.id), data: { receitaZerada: true } }));
    const clientesAtualizados = {};
    Object.entries(_clientesFirestore).forEach(([key, c]) => {
      if (c && Array.isArray(c.planoPagamentos) && c.planoPagamentos.some(p => !p.zerado)) {
        const lista = c.planoPagamentos.map(p => p.zerado ? p : { ...p, zerado: true });
        clientesAtualizados[key] = lista;
        ops.push({ ref: db.collection('clientes').doc(key), data: { planoPagamentos: lista } });
      }
    });
    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach(o => batch.update(o.ref, o.data));
      await batch.commit();
    }
    allAgendamentos.forEach(a => { if (a.status === 'concluido') a.receitaZerada = true; });
    Object.entries(clientesAtualizados).forEach(([key, lista]) => { _clientesFirestore[key].planoPagamentos = lista; });
    fecharZerarReceitas();
    showToast('Receitas zeradas.');
    try { renderDashboard(); } catch (e) {}
    try { renderClientes(); } catch (e) {}
  } catch (e) {
    console.warn(e);
    st.style.color = '#e05555'; st.textContent = 'Erro ao zerar: ' + (e.message || e.code || e);
    validarZerarReceitas();
  }
}

async function removerPlanoCliente(key) {
  const c = _clientesFirestore[key];
  if (!c) return;
  if (!confirm('Remover o plano de ' + (c.nome || key) + '? Ele volta a pagar os serviços normalmente a partir de hoje. O histórico e os pagamentos já feitos são mantidos.')) return;
  try {
    const del = firebase.firestore.FieldValue.delete();
    const removidoEm = hojeISOAdmin();
    const pagamentos = (Array.isArray(c.planoPagamentos) ? c.planoPagamentos : [])
      .map(p => p.encerradoEm ? p : { ...p, encerradoEm: removidoEm });
    const upd = { plano: del, planoPagoEm: del, planoVenceEm: del, planoRemovidoEm: removidoEm };
    if (pagamentos.length) upd.planoPagamentos = pagamentos;
    await db.collection('clientes').doc(key).update(upd);
    delete _clientesFirestore[key].plano;
    delete _clientesFirestore[key].planoPagoEm;
    delete _clientesFirestore[key].planoVenceEm;
    _clientesFirestore[key].planoRemovidoEm = removidoEm;
    if (pagamentos.length) _clientesFirestore[key].planoPagamentos = pagamentos;
    showToast('Plano removido.');
    renderPlanosClientes();
    try { renderDashboard(); } catch (e) {}
    try { renderClientes(); } catch (e) {}
  } catch (e) {
    console.warn(e);
    showToast('Erro ao remover o plano.');
  }
}


// Ao abrir o painel: avisa os planos que vencem hoje ou já venceram
async function verificarPlanosGlobal() {
  if (BARBEARIA.planosAtivos === false) return;   // barbearia sem planos
  try {
    const snap = await db.collection('clientes').get();
    const cobrar = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.plano && d.planoVenceEm && statusPlano(d.planoVenceEm).tipo !== 'ativo') cobrar.push({ key: doc.id, ...d });
    });
    if (!cobrar.length) return;
    cobrar.sort((a, b) => a.planoVenceEm.localeCompare(b.planoVenceEm));
    const nomes = cobrar.map(c => (c.nome || '').split(' ')[0]).join(', ');
    setTimeout(() => {
      showPlanoAlert(cobrar);
      enviarNotificacaoPlano(nomes, cobrar.length);
    }, 3000);
  } catch (e) {}
}

function showPlanoAlert(cobrar) {
  let el = document.getElementById('admin-plano-alert');
  if (!el) {
    el = document.createElement('div');
    el.id = 'admin-plano-alert';
    document.body.appendChild(el);
  }
  const aniv = document.getElementById('admin-aniv-alert');
  const top = (aniv && aniv.style.display !== 'none' && aniv.offsetHeight) ? aniv.offsetHeight + 32 : 20;
  el.style.cssText = 'position:fixed;top:' + top + 'px;right:20px;z-index:99998;max-width:360px;width:calc(100vw - 40px);';
  const lista = cobrar.map(c => {
    const st = statusPlano(c.planoVenceEm);
    const pl = planoDados(c.plano);
    const tel = chaveTelefone(c.telefone || c.key);
    const msg = encodeURIComponent(mensagemCobrancaPlano(c.nome, c.plano, c.planoVenceEm));
    const txt = st.tipo === 'hoje' ? 'Vence hoje' : 'Vencido há ' + st.dias + (st.dias === 1 ? ' dia' : ' dias');
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(201, 125, 92,0.15);">' +
      '<div style="flex:1;">' +
        '<div style="font-family:\'Oswald\',sans-serif;font-size:13px;color:#F1EAD6;letter-spacing:.5px;">' + escPlano(c.nome) + '</div>' +
        '<div style="font-family:\'Roboto\',sans-serif;font-size:11px;color:#C97D5C;">' + txt + ' · ' + escPlano(pl.nome) + ' · ' + fmtMoedaPlano(pl.preco) + '</div>' +
      '</div>' +
      (tel ? '<a href="https://wa.me/55' + tel + '?text=' + msg + '" target="_blank" style="background:#1a2e1a;border:1px solid #2a4a2a;color:#4caf50;padding:6px 12px;border-radius:5px;font-family:\'Oswald\',sans-serif;font-size:10px;letter-spacing:1px;text-transform:uppercase;text-decoration:none;white-space:nowrap;flex-shrink:0;">Cobrar →</a>' : '') +
    '</div>';
  }).join('');
  el.innerHTML =
    '<div style="background:#1a1208;border:1px solid #C97D5C;border-radius:10px;padding:18px 20px;box-shadow:0 8px 40px rgba(0,0,0,0.8);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
        '<span style="font-family:\'Oswald\',sans-serif;font-size:11px;letter-spacing:2px;color:#C97D5C;text-transform:uppercase;">Planos para Cobrar</span>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
          '<button onclick="showTab(\'clientes\',null);syncBottomNav(\'bnav-clientes\');document.getElementById(\'admin-plano-alert\').style.display=\'none\';" style="background:#C97D5C;border:none;color:#1E1310;padding:5px 12px;border-radius:5px;font-family:\'Oswald\',sans-serif;font-size:10px;letter-spacing:1px;text-transform:uppercase;cursor:pointer;font-weight:700;">Ver Planos</button>' +
          '<button onclick="document.getElementById(\'admin-plano-alert\').style.display=\'none\';" style="background:none;border:none;color:#A28A84;font-size:18px;cursor:pointer;line-height:1;padding:0 2px;">&times;</button>' +
        '</div>' +
      '</div>' +
      '<div>' + lista + '</div>' +
    '</div>';
  el.style.display = 'block';
}

async function enviarNotificacaoPlano(nomes, qtd) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(BARBEARIA.nome + ' — Plano para cobrar', {
      body: nomes + (qtd > 1 ? ': planos vencidos ou vencendo hoje. Hora de cobrar!' : ': plano vence hoje ou já venceu. Hora de cobrar!'),
      icon: 'logo.png',
      tag: 'plano-vencimento',
      requireInteraction: true,
    });
    n.onclick = () => { window.focus(); showTab('clientes', null); syncBottomNav('bnav-clientes'); n.close(); };
  } catch (e) {}
}

async function renderClientes() {
  await carregarClientesFirestore();
  const map = buildClientMap();
  const clientes = Object.values(map).map(c => ({ ...c, stats: calcClientStats(c.agendamentos) }));
  _clientListCache = clientes;

  renderAniversariantesBanner(clientes);
  renderPlanosClientes();

  const totalClientes = clientes.length;
  const totalGasto    = clientes.reduce((s, c) => s + c.stats.gastoTotal, 0);
  const totalConc     = clientes.reduce((s, c) => s + c.stats.pagos, 0);
  const ticketMedio   = totalConc ? totalGasto / totalConc : 0; // só atendimentos pagos
  const totalPlanos   = receitaDePlanos('', '');                 // mensalidades de planos
  const clienteTop    = [...clientes].sort((a, b) => b.stats.gastoTotal - a.stats.gastoTotal)[0];

  const resumoEl = document.getElementById('clientes-resumo');
  if (resumoEl) {
    resumoEl.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:0;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.05);border-radius:8px;overflow:hidden;margin-bottom:28px;';
    const svgClientes = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>`;
    const svgReceita  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>`;
    const svgTicket   = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
    const svgTop      = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
    resumoEl.innerHTML = [
      { icon: svgClientes, val: totalClientes,   label: 'Total de Clientes' },
      { icon: svgReceita,  val: 'R$' + (totalGasto + totalPlanos).toFixed(2).replace('.', ','), label: totalPlanos > 0 ? 'Receita Total (com planos)' : 'Receita Total' },
      { icon: svgTicket,   val: isNaN(ticketMedio)||!isFinite(ticketMedio) ? 'R$0,00' : 'R$' + ticketMedio.toFixed(2).replace('.', ','), label: 'Ticket Médio' },
      { icon: svgTop,      val: clienteTop ? clienteTop.nome.split(' ')[0] : '—', label: 'Maior Gastador' },
    ].map((c, i) => `
      <div style="background:#2E1D19;padding:18px 20px;border-right:${i < 3 ? '1px solid rgba(255,255,255,0.04)' : 'none'};">
        <div style="color:#68443D;margin-bottom:10px;">${c.icon}</div>
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:26px;color:#F1EAD6;letter-spacing:1px;line-height:1;">${c.val}</div>
        <div style="font-family:'Oswald',sans-serif;font-size:9px;letter-spacing:2px;color:#8D7670;text-transform:uppercase;margin-top:6px;">${c.label}</div>
      </div>
    `).join('');
  }

  filtrarClientes();
}

function filtrarClientes() {
  const search = (document.getElementById('clientes-search')?.value || '').toLowerCase();
  const sort   = document.getElementById('clientes-sort')?.value || 'nome';
  let lista = _clientListCache.filter(c =>
    c.nome.toLowerCase().includes(search) || c.telefone.includes(search)
  );
  lista.sort((a, b) => {
    if (sort === 'nome')    return a.nome.localeCompare(b.nome);
    if (sort === 'visitas') return b.stats.total - a.stats.total;
    if (sort === 'ticket')  return b.stats.ticket - a.stats.ticket;
    if (sort === 'gasto')   return b.stats.gastoTotal - a.stats.gastoTotal;
    if (sort === 'recente') return (b.stats.ultimaVisita || '').localeCompare(a.stats.ultimaVisita || '');
    return 0;
  });

  const el = document.getElementById('clientes-lista');
  if (!el) return;
  if (!lista.length) {
    el.innerHTML = '<p style="color:#80544C;font-family:Oswald,sans-serif;font-size:13px;letter-spacing:1px;padding:20px 0;">Nenhum cliente encontrado.</p>';
    return;
  }

  el.innerHTML = `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:8px;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <th style="font-family:'Oswald',sans-serif;font-size:8px;letter-spacing:2px;color:#5E3C36;text-transform:uppercase;padding:8px 20px;font-weight:400;text-align:left;">Cliente</th>
            <th style="font-family:'Oswald',sans-serif;font-size:8px;letter-spacing:2px;color:#5E3C36;text-transform:uppercase;padding:8px 4px;font-weight:400;text-align:center;width:70px;">Visitas</th>
            <th style="font-family:'Oswald',sans-serif;font-size:8px;letter-spacing:2px;color:#5E3C36;text-transform:uppercase;padding:8px 4px;font-weight:400;text-align:center;width:80px;">Ticket</th>
            <th style="font-family:'Oswald',sans-serif;font-size:8px;letter-spacing:2px;color:#5E3C36;text-transform:uppercase;padding:8px 4px;font-weight:400;text-align:center;width:90px;">Total</th>
            <th style="font-family:'Oswald',sans-serif;font-size:8px;letter-spacing:2px;color:#5E3C36;text-transform:uppercase;padding:8px 4px;font-weight:400;text-align:center;width:120px;">Favorito</th>
            <th style="font-family:'Oswald',sans-serif;font-size:8px;letter-spacing:2px;color:#5E3C36;text-transform:uppercase;padding:8px 20px 8px 4px;font-weight:400;text-align:right;width:110px;">Última Visita</th>
            <th style="width:24px;"></th>
          </tr>
        </thead>
        <tbody>
      ${lista.map(c => {
        const s = c.stats;
        const favorito   = s.servicoFavorito ? s.servicoFavorito[0] : '—';
        const ultimaFmt  = s.ultimaVisita ? s.ultimaVisita.split('-').reverse().join('/') : '—';
        const nascFmt    = c.nascimento ? fmtNascimento(c.nascimento) : '';
        const anivAmanha = isAniversarioAmanha(c.nascimento);
        const encData    = encodeURIComponent(JSON.stringify({ nome: c.nome, telefone: c.telefone, nascimento: c.nascimento || '', agendamentos: c.agendamentos }));
        return `<tr onclick="abrirClienteDrawer('${encData}')"
          style="background:#2E1D19;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.025);${anivAmanha ? 'border-left:3px solid #C97D5C;' : ''}"
          onmouseover="this.style.background='#1b1b1b'" onmouseout="this.style.background='#2E1D19'">
          <td style="padding:13px 20px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="width:36px;height:36px;border-radius:50%;background:${anivAmanha ? '#2a1e00' : '#422A24'};border:1px solid ${anivAmanha ? '#C97D5C' : '#4A302A'};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',Georgia,serif;font-size:15px;color:${anivAmanha ? '#C97D5C' : '#8D7670'};flex-shrink:0;">${(c.nome||'?')[0].toUpperCase()}</div>
              <div>
                <div style="font-family:'Oswald',sans-serif;font-size:14px;font-weight:500;color:#F1EAD6;">${c.nome}${anivAmanha ? '&nbsp;<span style="font-size:8px;background:#2a1e00;color:#C97D5C;letter-spacing:1px;padding:2px 5px;border-radius:3px;border:1px solid #4a3800;">\uD83C\uDF82 AMANHÃ</span>' : ''}</div>
                <div style="font-family:'Roboto',sans-serif;font-size:11px;color:#784F46;margin-top:2px;">${c.telefone}${nascFmt ? ' · ' + nascFmt : ''}</div>
              </div>
            </div>
          </td>
          <td style="text-align:center;padding:13px 4px;">
            <span style="font-family:'Playfair Display',Georgia,serif;font-size:20px;color:#F1EAD6;line-height:1;">${s.total}</span>
          </td>
          <td style="text-align:center;padding:13px 4px;">
            <span style="font-family:'Playfair Display',Georgia,serif;font-size:18px;color:#C97D5C;line-height:1;">R$${s.ticket.toFixed(0)}</span>
          </td>
          <td style="text-align:center;padding:13px 4px;">
            <span style="font-family:'Playfair Display',Georgia,serif;font-size:18px;color:#F1EAD6;line-height:1;">R$${s.gastoTotal.toFixed(0)}</span>
          </td>
          <td style="text-align:center;padding:13px 4px;">
            <span style="font-family:'Roboto',sans-serif;font-size:11px;color:#A28A84;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;">${favorito}</span>
          </td>
          <td style="text-align:right;padding:13px 20px 13px 4px;">
            <span style="font-family:'Roboto',sans-serif;font-size:11px;color:#4a4a4a;white-space:nowrap;">${ultimaFmt}</span>
          </td>
          <td style="text-align:right;padding-right:12px;color:#543731;font-size:15px;">›</td>
        </tr>`;
      }).join('')}
        </tbody>
      </table>
    </div>`;
}

function abrirClienteDrawer(encodedData) {
  const c = JSON.parse(decodeURIComponent(encodedData));
  const s = calcClientStats(c.agendamentos);
  const anivAmanha = isAniversarioAmanha(c.nascimento);

  document.getElementById('drawer-nome').textContent = c.nome;
  document.getElementById('drawer-tel').textContent  = c.telefone;
  const drawerNasc = document.getElementById('drawer-nasc');
  if (drawerNasc) drawerNasc.innerHTML = c.nascimento
    ? fmtNascimento(c.nascimento) + (anivAmanha ? ' <span style="color:#C97D5C;font-size:10px;letter-spacing:1px;">· AMANHÃ!</span>' : '')
    : '';

  const ags = [...c.agendamentos].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const servicosRank = Object.entries(s.servicoMap).sort((a, b) => b[1] - a[1]);
  const tel = (c.telefone || '').replace(/\D/g, '');
  const msgAniv = encodeURIComponent(mensagemAniversario(c.nome));

  document.getElementById('drawer-content').innerHTML = `
    ${anivAmanha && tel ? `<div style="background:#1a1208;border:1px solid #4a3800;border-radius:8px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <span style="font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:1px;color:#C97D5C;">Aniversário amanhã! Que tal enviar uma mensagem?</span>
      <a href="https://wa.me/55${tel}?text=${msgAniv}" target="_blank"
        style="background:#1a2e1a;border:1px solid #2a4a2a;color:#4caf50;padding:8px 14px;border-radius:6px;font-family:'Oswald',sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;text-decoration:none;white-space:nowrap;">
        Enviar Parabens →
      </a>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.06);border-radius:8px;overflow:hidden;margin-bottom:24px;">
      ${[
        { icon: '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"#8D7670\" stroke-width=\"1.5\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M16 2v4M8 2v4M3 10h18\"/></svg>', val: s.total, label: 'Visitas' },
        { icon: '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"#8D7670\" stroke-width=\"1.5\"><path d=\"M22 11.08V12a10 10 0 11-5.93-9.14\"/><polyline points=\"22 4 12 14.01 9 11.01\"/></svg>', val: s.concluidos, label: 'Concluídos' },
        { icon: '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"#8D7670\" stroke-width=\"1.5\"><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"23\"/><path d=\"M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6\"/></svg>', val: 'R$' + s.gastoTotal.toFixed(2).replace('.', ','), label: 'Total Gasto' },
        { icon: '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"#8D7670\" stroke-width=\"1.5\"><polyline points=\"22 12 18 12 15 21 9 3 6 12 2 12\"/></svg>', val: 'R$' + s.ticket.toFixed(2).replace('.', ','), label: 'Ticket Médio' },
        { icon: '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"#8D7670\" stroke-width=\"1.5\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 3\"/></svg>', val: s.ultimaVisita ? s.ultimaVisita.split('-').reverse().join('/') : '—', label: 'Última Visita' },
        { icon: '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"#8D7670\" stroke-width=\"1.5\"><path d=\"M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z\"/></svg>', val: s.servicoFavorito ? s.servicoFavorito[0].split('+')[0].trim() : '—', label: 'Serviço Favorito' },
      ].map(m => `
        <div style="background:#2E1D19;padding:14px 16px;text-align:center;">
          <div style="display:flex;justify-content:center;margin-bottom:6px;">${m.icon}</div>
          <div style="font-family:'Playfair Display',Georgia,serif;font-size:18px;color:#F1EAD6;letter-spacing:1px;line-height:1;">${m.val}</div>
          <div style="font-family:'Oswald',sans-serif;font-size:9px;letter-spacing:1.5px;color:#80544C;text-transform:uppercase;margin-top:4px;">${m.label}</div>
        </div>
      `).join('')}
    </div>

    ${servicosRank.length ? `<div style="margin-bottom:24px;">
      <p style="font-family:'Oswald',sans-serif;font-size:11px;letter-spacing:2px;color:#8D7670;text-transform:uppercase;margin-bottom:12px;">Serviços Mais Usados</p>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${servicosRank.map(([serv, qtd]) => {
          const pct = Math.round((qtd / s.total) * 100);
          return `<div>
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span style="font-family:'Roboto',sans-serif;font-size:13px;color:#D1C3BF;">${serv}</span>
              <span style="font-family:'Playfair Display',Georgia,serif;font-size:14px;color:#F1EAD6;">${qtd}x</span>
            </div>
            <div style="background:#422A24;border-radius:2px;height:3px;overflow:hidden;">
              <div style="background:#C97D5C;height:100%;width:${pct}%;"></div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}

    ${ags.length ? `<div>
      <p style="font-family:'Oswald',sans-serif;font-size:11px;letter-spacing:2px;color:#8D7670;text-transform:uppercase;margin-bottom:12px;">Histórico de Visitas</p>
      <div style="display:flex;flex-direction:column;gap:1px;background:rgba(255,255,255,0.04);border-radius:6px;overflow:hidden;">
        ${ags.map(a => `
          <div style="background:#2E1D19;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
            <div>
              <div style="font-family:'Roboto',sans-serif;font-size:13px;color:#F1EAD6;">${a.servico || '—'}</div>
              <div style="font-family:'Roboto',sans-serif;font-size:11px;color:#80544C;margin-top:2px;">${a.data ? a.data.split('-').reverse().join('/') : '—'} ${a.horario ? '· ' + a.horario : ''}</div>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="font-family:'Playfair Display',Georgia,serif;font-size:16px;color:#C97D5C;">${fmtValorAgd(a)}</span>
              ${badgeHTML(a.status)}
              <button onclick="deleteAgendamento('${a.id}')" title="Excluir"
                style="background:transparent;border:1px solid rgba(176,48,48,0.3);color:#d45a5a;width:28px;height:28px;border-radius:4px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"
                onmouseover="this.style.background='rgba(176,48,48,0.15)'"
                onmouseout="this.style.background='transparent'">✕</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    ${tel ? `<a href="https://wa.me/55${tel}" target="_blank"
      style="display:block;margin-top:24px;text-align:center;background:#422A24;border:1px solid #68443D;color:#D1C3BF;padding:14px;border-radius:6px;font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;"
      onmouseover="this.style.background='#543731'" onmouseout="this.style.background='#422A24'">
      Abrir WhatsApp →
    </a>` : ''}

    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #422A24;">
      <button onclick="confirmarExcluirCliente('${encodeURIComponent(c.nome)}', '${(c.telefone||'').replace(/\D/g,'')}')"
        style="width:100%;background:transparent;border:1px solid rgba(176,48,48,0.35);color:#d45a5a;padding:12px;border-radius:4px;cursor:pointer;font-family:'Oswald',sans-serif;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;font-weight:700;transition:all .2s;"
        onmouseover="this.style.background='rgba(176,48,48,0.1)';this.style.borderColor='#d45a5a'"
        onmouseout="this.style.background='transparent';this.style.borderColor='rgba(176,48,48,0.35)'">
        Excluir Este Cliente
      </button>
    </div>
  `;

  document.getElementById('cliente-drawer').style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function fecharClienteDrawer(e) {
  if (e && e.target !== document.getElementById('cliente-drawer')) return;
  document.getElementById('cliente-drawer').style.display = 'none';
  document.body.style.overflow = '';
  // Close excluir-cliente modal too if open
  const ecm = document.getElementById('excluir-cliente-modal');
  if (ecm) ecm.style.display = 'none';
}

// Verifica aniversários ao carregar o admin (mesmo sem abrir a aba)
async function verificarAniversariosGlobal() {
  try {
    const snap = await db.collection('clientes').get();
    const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
    const aniversariantes = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.nascimento) {
        const [, m, dia] = d.nascimento.split('-');
        if (parseInt(m) === (amanha.getMonth() + 1) && parseInt(dia) === amanha.getDate()) {
          aniversariantes.push(d);
        }
      }
    });
    if (aniversariantes.length) {
      const nomes = aniversariantes.map(c => c.nome.split(' ')[0]).join(', ');
      setTimeout(() => {
        showAniversarioAlert(aniversariantes);
        enviarNotificacaoBrowser(nomes);
      }, 1500);
    }
  } catch(e) {}
}

function showAniversarioAlert(aniversariantes) {
  // Adiciona animação CSS se não existir
  if (!document.getElementById('aniv-alert-style')) {
    const s = document.createElement('style');
    s.id = 'aniv-alert-style';
    s.textContent = '@keyframes slideInRight { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:none; } }';
    document.head.appendChild(s);
  }
  let el = document.getElementById('admin-aniv-alert');
  if (!el) {
    el = document.createElement('div');
    el.id = 'admin-aniv-alert';
    el.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;max-width:360px;width:calc(100vw - 40px);animation:slideInRight .35s ease;';
    document.body.appendChild(el);
  }
  const lista = aniversariantes.map(c => {
    const tel = (c.telefone || '').replace(/\D/g, '');
    const msg = encodeURIComponent(mensagemAniversario(c.nome));
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(201, 125, 92,0.15);">
      <div style="flex:1;">
        <div style="font-family:'Oswald',sans-serif;font-size:13px;color:#F1EAD6;letter-spacing:.5px;">${c.nome}</div>
        <div style="font-family:'Roboto',sans-serif;font-size:11px;color:#C97D5C;">Anivers\u00e1rio amanh\u00e3!</div>
      </div>
      ${tel ? `<a href="https://wa.me/55${tel}?text=${msg}" target="_blank"
        style="background:#1a2e1a;border:1px solid #2a4a2a;color:#4caf50;padding:6px 12px;border-radius:5px;font-family:'Oswald',sans-serif;font-size:10px;letter-spacing:1px;text-transform:uppercase;text-decoration:none;white-space:nowrap;flex-shrink:0;">
        WhatsApp \u2192
      </a>` : ''}
    </div>`;
  }).join('');
  el.innerHTML = `
    <div style="background:#1a1208;border:1px solid #C97D5C;border-radius:10px;padding:18px 20px;box-shadow:0 8px 40px rgba(0,0,0,0.8);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-family:'Oswald',sans-serif;font-size:11px;letter-spacing:2px;color:#C97D5C;text-transform:uppercase;">\uD83C\uDF89 Anivers\u00e1rios Amanh\u00e3</span>
        <div style="display:flex;gap:8px;align-items:center;">
          <button onclick="showTab('clientes',null);syncBottomNav('bnav-clientes');document.getElementById('admin-aniv-alert').style.display='none';"
            style="background:#C97D5C;border:none;color:#1E1310;padding:5px 12px;border-radius:5px;font-family:'Oswald',sans-serif;font-size:10px;letter-spacing:1px;text-transform:uppercase;cursor:pointer;font-weight:700;">
            Ver Clientes
          </button>
          <button onclick="document.getElementById('admin-aniv-alert').style.display='none';"
            style="background:none;border:none;color:#A28A84;font-size:18px;cursor:pointer;line-height:1;padding:0 2px;">&times;</button>
        </div>
      </div>
      <div>${lista}</div>
    </div>
  `;
  el.style.display = 'block';
}

async function enviarNotificacaoBrowser(nomes) {
  if (!('Notification' in window)) return;
  try {
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const n = new Notification('\uD83C\uDF82 ' + BARBEARIA.nome + ' — Anivers\u00e1rio Amanh\u00e3!', {
      body: nomes + (nomes.includes(',') ? ' fazem' : ' faz') + ' anivers\u00e1rio amanh\u00e3. Envie uma mensagem de parab\u00e9ns!',
      icon: 'logo.png',
      tag: 'aniversario-vr',
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      showTab('clientes', null);
      syncBottomNav('bnav-clientes');
      n.close();
    };
  } catch(e) {}
}

function showToast(msg, duration = 4000) { showAdminToast(msg, duration); }

function showAdminToast(msg, duration = 4000) {
  let toast = document.getElementById('admin-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'admin-toast';
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#2a1e00;border:1px solid #C97D5C;color:#F1EAD6;padding:14px 24px;border-radius:8px;font-family:Oswald,sans-serif;font-size:13px;letter-spacing:1px;z-index:99999;max-width:90vw;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.7);';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.display = 'none'; }, duration);
}

function buildClienteMap() {
  const map = {};
  allAgendamentos.forEach(a => {
    const key = (a.telefone || '').replace(/\D/g, '') || a.cliente || 'desconhecido';
    if (!map[key]) {
      map[key] = {
        nome: a.cliente || '—',
        telefone: a.telefone || '—',
        agendamentos: [],
      };
    }
    // Atualiza nome mais recente
    if (a.cliente) map[key].nome = a.cliente;
    map[key].agendamentos.push(a);
  });
  return map;
}

function formatDate(d) {
  const [y, m, day] = d.split('-');
  return day + '/' + m + '/' + y;
}

function badgeHTML(status) {
  const labels = { agendado:'Agendado', confirmado:'Confirmado', concluido:'Concluido', cancelado:'Cancelado' };
  return '<span class="badge badge-' + (status||'agendado') + '">' + (labels[status]||status) + '</span>';
}

// ── Datas Especiais ──────────────────────────────

function toggleDETipo() {
  const tipo = document.getElementById('de-tipo').value;
  document.getElementById('de-horarios-wrap').style.display = tipo === 'aberto' ? 'flex' : 'none';
}

function toggleDEAlmoco() {
  deAlmocoAtivo = !deAlmocoAtivo;
  const toggle = document.getElementById('de-almoco-toggle');
  const knob   = document.getElementById('de-almoco-knob');
  const wrap   = document.getElementById('de-almoco-wrap');
  toggle.style.background = deAlmocoAtivo ? '#8D7670' : '#543731';
  knob.style.left         = deAlmocoAtivo ? '19px' : '3px';
  wrap.style.opacity      = deAlmocoAtivo ? '1' : '.3';
  wrap.style.pointerEvents = deAlmocoAtivo ? 'auto' : 'none';
}

async function carregarDatasEspeciais() {
  try {
    const doc = await db.collection('config').doc('datas_especiais').get();
    datasEspeciais = doc.exists ? (doc.data() || {}) : {};
  } catch(e) { datasEspeciais = {}; }
  renderDatasLista();
}

function renderDatasLista() {
  const el = document.getElementById('datas-list');
  if (!el) return;
  const keys = Object.keys(datasEspeciais).sort();
  if (!keys.length) {
    el.innerHTML = '<p style="color:#80544C;font-family:Oswald,sans-serif;font-size:13px;letter-spacing:1px;padding:16px 0;">Nenhuma data especial cadastrada.</p>';
    return;
  }
  el.innerHTML = keys.map(data => {
    const d = datasEspeciais[data];
    const isFechado = d.tipo === 'fechado';
    const cor = isFechado ? '#b03030' : '#1f9e54';
    const icone = isFechado ? '—' : '+';
    const [y, m, day] = data.split('-');
    const dataFmt = day + '/' + m + '/' + y;
    let horarioInfo = isFechado ? 'Fechado' : (d.inicio + ' → ' + d.fim);
    if (!isFechado && d.almoco) horarioInfo += ' | Almoço: ' + d.almoco_inicio + '→' + d.almoco_fim;
    return `<div style="background:#2E1D19;border:1px solid #422A24;border-radius:6px;padding:14px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
      <span style="font-family:'Oswald',sans-serif;font-size:15px;color:#F1EAD6;letter-spacing:1px;min-width:100px;">${dataFmt}</span>
      <span style="font-family:'Roboto',sans-serif;font-size:13px;color:#D1C3BF;flex:1;">${d.desc || '—'}</span>
      <span style="font-family:'Roboto',sans-serif;font-size:12px;color:${cor};">${icone} ${horarioInfo}</span>
      <button onclick="removerDataEspecial('${data}')"
        style="background:#6a1a1a;border:none;color:#F1EAD6;padding:6px 14px;border-radius:4px;cursor:pointer;font-family:'Oswald',sans-serif;font-size:11px;letter-spacing:1px;white-space:nowrap;">
        Remover
      </button>
    </div>`;
  }).join('');
}

async function adicionarDataEspecial() {
  const data   = document.getElementById('de-data').value;
  const desc   = document.getElementById('de-desc').value.trim();
  const tipo   = document.getElementById('de-tipo').value;
  const inicio = document.getElementById('de-inicio').value;
  const fim    = document.getElementById('de-fim').value;
  const almocoInicio = document.getElementById('de-almoco-inicio').value;
  const almocoFim    = document.getElementById('de-almoco-fim').value;

  if (!data) { alert('Selecione uma data.'); return; }
  if (tipo === 'aberto' && (!inicio || !fim)) { alert('Defina os horários de abertura e fechamento.'); return; }

  datasEspeciais[data] = {
    desc,
    tipo,
    inicio:       tipo === 'aberto' ? inicio : '',
    fim:          tipo === 'aberto' ? fim    : '',
    almoco:       tipo === 'aberto' ? deAlmocoAtivo : false,
    almoco_inicio: tipo === 'aberto' && deAlmocoAtivo ? almocoInicio : '',
    almoco_fim:    tipo === 'aberto' && deAlmocoAtivo ? almocoFim    : '',
  };

  try {
    // Usa set com merge:true para não sobrescrever outros campos do documento
    // e funciona mesmo se o documento ainda não existir
    const docRef = db.collection('config').doc('datas_especiais');
    await docRef.set({ ...datasEspeciais }, { merge: true });
    // Reset form
    document.getElementById('de-data').value   = '';
    document.getElementById('de-desc').value   = '';
    document.getElementById('de-tipo').value   = 'aberto';
    document.getElementById('de-inicio').value = '08:00';
    document.getElementById('de-fim').value    = '17:00';
    toggleDETipo();
    if (deAlmocoAtivo) toggleDEAlmoco();
    renderDatasLista();
  } catch(e) {
    console.error('Erro ao salvar data especial:', e);
    alert('Erro ao salvar: ' + (e.message || e.code || 'Verifique as regras do Firestore.'));
  }
}

async function removerDataEspecial(data) {
  if (!confirm('Remover a data ' + formatDate(data) + '?')) return;
  try {
    // Usa FieldValue.delete() para remover só esse campo, sem apagar os outros
    const update = {};
    update[data] = firebase.firestore.FieldValue.delete();
    await db.collection('config').doc('datas_especiais').update(update);
    delete datasEspeciais[data];
    renderDatasLista();
  } catch(e) {
    console.error('Erro ao remover data especial:', e);
    alert('Erro ao remover: ' + (e.message || e.code || 'Verifique as regras do Firestore.'));
  }
}

  

// ── Excluir Cliente Individual ───────────────────
let _excluirClienteKey = null;

function confirmarExcluirCliente(encodedNome, tel) {
  const nome = decodeURIComponent(encodedNome);
  _excluirClienteKey = tel;
  document.getElementById('excluir-cliente-nome').textContent = nome;
  const modal = document.getElementById('excluir-cliente-modal');
  modal.style.display = 'flex';

  document.getElementById('excluir-cliente-confirmar').onclick = async () => {
    const btn = document.getElementById('excluir-cliente-confirmar');
    btn.textContent = 'Excluindo...';
    btn.disabled = true;
    try {
      // Salva o telefone ANTES de deletar do cache
      const telParaBusca = (_clientesFirestore[_excluirClienteKey]?.telefone || _excluirClienteKey).replace(/\D/g, '');

      // Exclui o cliente
      await db.collection('clientes').doc(_excluirClienteKey).delete();
      delete _clientesFirestore[_excluirClienteKey];

      // Exclui todos os agendamentos do cliente (pelo telefone)
      const tel = telParaBusca;
      const agSnap = await db.collection('agendamentos')
        .where('telefone', '==', tel)
        .get();
      const batch = db.batch();
      agSnap.forEach(doc => batch.delete(doc.ref));
      // Tenta também pelo formato com máscara
      if (!agSnap.empty || true) {
        // Busca pelos agendamentos já carregados em memória
        const agsDoCli = allAgendamentos.filter(a =>
          (a.telefone || '').replace(/\D/g,'') === tel
        );
        agsDoCli.forEach(a => batch.delete(db.collection('agendamentos').doc(a.id)));
      }
      await batch.commit();

      fecharModalExcluirCliente();
      fecharClienteDrawer();
      showToast('Cliente e agendamentos excluídos.');
      renderClientes();
    } catch(e) {
      btn.textContent = 'Excluir';
      btn.disabled = false;
      alert('Erro ao excluir: ' + (e.message || e.code));
    }
  };
}

function fecharModalExcluirCliente() {
  document.getElementById('excluir-cliente-modal').style.display = 'none';
  _excluirClienteKey = null;
}

// ── Excluir Todos os Clientes ────────────────────
function abrirModalExcluirTodosClientes() {
  const total = _clientListCache.length;
  if (!total) { showToast('Nenhum cliente cadastrado.'); return; }
  document.getElementById('excluir-todos-count').textContent =
    total === 1 ? '1 cliente' : total + ' clientes';
  document.getElementById('excluir-todos-confirm-input').value = '';
  const btn = document.getElementById('excluir-todos-confirmar');
  btn.disabled = true;
  btn.style.background = 'rgba(176,48,48,0.08)';
  btn.style.borderColor = 'rgba(176,48,48,0.2)';
  btn.style.color = '#A28A84';
  btn.style.cursor = 'not-allowed';
  document.getElementById('excluir-todos-clientes-modal').style.display = 'flex';
}

function validarConfirmacaoExcluirTodos() {
  const val = (document.getElementById('excluir-todos-confirm-input')?.value || '').trim().toUpperCase();
  const btn = document.getElementById('excluir-todos-confirmar');
  const ok = val === 'EXCLUIR TUDO';
  btn.disabled = !ok;
  btn.style.background    = ok ? 'rgba(176,48,48,0.2)'   : 'rgba(176,48,48,0.08)';
  btn.style.borderColor   = ok ? 'rgba(176,48,48,0.6)'   : 'rgba(176,48,48,0.2)';
  btn.style.color         = ok ? '#d45a5a'                : '#A28A84';
  btn.style.cursor        = ok ? 'pointer'                : 'not-allowed';

  if (ok) {
    btn.onclick = async () => {
      btn.textContent = 'Excluindo...';
      btn.disabled = true;
      try {
        const snap = await db.collection('clientes').get();
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        _clientesFirestore = {};
        fecharModalExcluirTodosClientes();
        showToast('Todos os clientes foram excluídos.');
        renderClientes();
      } catch(e) {
        btn.textContent = 'Excluir Tudo';
        btn.disabled = false;
        alert('Erro ao excluir: ' + (e.message || e.code));
      }
    };
  }
}

function fecharModalExcluirTodosClientes() {
  document.getElementById('excluir-todos-clientes-modal').style.display = 'none';
}


// ── Sistema de Notificações ──────────────────────

function notificarNovoAgendamento(a) {
  const nome    = a.cliente || 'Cliente';
  const servico = a.servico || 'Serviço';
  const data    = a.data    ? a.data.split('-').reverse().join('/') : '';
  const hora    = a.horario || '';

  // Adiciona à lista interna
  const notif = {
    id:   a.id,
    nome, servico, data, hora,
    ts:   Date.now(),
    lida: false,
  };
  _notificacoes.unshift(notif);

  // Atualiza badge
  atualizarBadgeNotif();

  // Toca som sutil (beep via AudioContext)
  tocarSomNotificacao();

  // Toast customizado de novo agendamento
  showToastAgendamento(nome, servico, data, hora);

  // Notificação do browser (se permitido)
  if (Notification.permission === 'granted') {
    new Notification('Novo Agendamento — ' + BARBEARIA.nome, {
      body: nome + ' · ' + servico + (data ? ' · ' + data : '') + (hora ? ' às ' + hora : ''),
      icon: 'logo.png',
      tag:  'vr-agendamento-' + a.id,
      silent: false,
    });
  }

  // Renderiza painel
  renderNotifPanel();
}

function atualizarBadgeNotif() {
  const naoLidas = _notificacoes.filter(n => !n.lida).length;
  const badge = document.getElementById('notif-badge');
  const icon  = document.getElementById('bell-icon');
  if (!badge || !icon) return;
  if (naoLidas > 0) {
    badge.style.display = 'block';
    icon.querySelector('path').setAttribute('stroke', '#F1EAD6');
  } else {
    badge.style.display = 'none';
    icon.querySelector('path').setAttribute('stroke', '#B39B96');
  }
}

function renderNotifPanel() {
  const el = document.getElementById('notif-list');
  if (!el) return;
  if (!_notificacoes.length) {
    el.innerHTML = '<div style="padding:28px 18px;text-align:center;font-family:Oswald,sans-serif;font-size:11px;letter-spacing:2px;color:#5E3C36;text-transform:uppercase;">Nenhuma notificação</div>';
    return;
  }
  el.innerHTML = _notificacoes.map(n => {
    const ago = formatAgo(n.ts);
    const bgNormal = n.lida ? 'transparent' : 'rgba(255,255,255,0.025)';
    const dotColor = n.lida ? '#5E3C36' : '#d45a5a';
    const div = document.createElement('div');
    div.style.cssText = 'padding:14px 18px;border-bottom:1px solid #38231F;cursor:pointer;background:' + bgNormal + ';transition:background .2s;display:flex;gap:12px;align-items:flex-start;';
    div.onmouseover = function() { this.style.background = 'rgba(255,255,255,0.04)'; };
    div.onmouseout  = function() { this.style.background = bgNormal; };
    div.onclick     = function() { irParaAgendamento(n.id); };
    div.innerHTML = '<div style="width:6px;height:6px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;margin-top:5px;"></div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-family:Oswald,sans-serif;font-size:13px;color:#F1EAD6;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + n.nome + '</div>' +
        '<div style="font-family:Roboto,sans-serif;font-size:12px;color:#8D7670;margin-top:2px;">' + n.servico + (n.data ? ' · ' + n.data : '') + (n.hora ? ' às ' + n.hora : '') + '</div>' +
        '<div style="font-family:Roboto,sans-serif;font-size:10px;color:#5E3C36;margin-top:4px;letter-spacing:0.5px;">' + ago + '</div>' +
      '</div>';
    return div.outerHTML;
  }).join('');
}

function formatAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)  return 'agora mesmo';
  if (diff < 3600) return Math.floor(diff / 60) + ' min atrás';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h atrás';
  return Math.floor(diff / 86400) + 'd atrás';
}

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  _notifPanelOpen = !_notifPanelOpen;
  panel.style.display = _notifPanelOpen ? 'flex' : 'none';
  if (_notifPanelOpen) {
    // Marcar todas como lidas ao abrir
    _notificacoes.forEach(n => n.lida = true);
    atualizarBadgeNotif();
    renderNotifPanel();
    // Fechar ao clicar fora
    setTimeout(() => {
      document.addEventListener('click', fecharNotifPanelFora, { once: true });
    }, 10);
  }
}

function fecharNotifPanelFora(e) {
  const panel = document.getElementById('notif-panel');
  const bell  = document.getElementById('notif-bell');
  if (panel && !panel.contains(e.target) && !bell.contains(e.target)) {
    panel.style.display = 'none';
    _notifPanelOpen = false;
  }
}

function limparNotificacoes() {
  _notificacoes = [];
  atualizarBadgeNotif();
  renderNotifPanel();
}

function irParaAgendamento(id) {
  const panel = document.getElementById('notif-panel');
  if (panel) panel.style.display = 'none';
  _notifPanelOpen = false;
  // Vai para aba de agendamentos e destaca o item
  const navItem = document.querySelector('.nav-item[onclick*="agendamentos"]');
  showTab('agendamentos', navItem);
  // Destaca linha após renderizar
  setTimeout(() => {
    const rows = document.querySelectorAll('#agendamentos-body tr');
    rows.forEach(row => {
      if (row.dataset.id === id) {
        row.style.background = 'rgba(212,90,90,0.1)';
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { row.style.background = ''; }, 2500);
      }
    });
  }, 300);
}

function showToastAgendamento(nome, servico, data, hora) {
  let toast = document.getElementById('notif-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'notif-toast';
    document.body.appendChild(toast);
  }
  toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#2E1D19;border:1px solid #4A302A;border-left:3px solid #d45a5a;color:#F1EAD6;padding:16px 20px;border-radius:4px;font-family:Oswald,sans-serif;z-index:99999;max-width:300px;box-shadow:0 16px 48px rgba(0,0,0,0.8);cursor:pointer;transition:opacity .3s;';
  toast.innerHTML = `
    <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#d45a5a;margin-bottom:6px;">Novo Agendamento</div>
    <div style="font-size:14px;letter-spacing:0.5px;margin-bottom:3px;">${nome}</div>
    <div style="font-size:12px;color:#8D7670;font-family:Roboto,sans-serif;">${servico}${data ? ' · ' + data : ''}${hora ? ' às ' + hora : ''}</div>
  `;
  toast.style.display = 'block';
  toast.style.opacity = '1';
  toast.onclick = () => { toast.style.opacity = '0'; setTimeout(() => { toast.style.display='none'; }, 300); };
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 300);
  }, 7000);
}

function tocarSomNotificacao() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const notas = [
      { freq: 520, t: 0.00, dur: 0.13 },
      { freq: 660, t: 0.17, dur: 0.13 },
      { freq: 880, t: 0.34, dur: 0.25 },
    ];
    notas.forEach(({ freq, t, dur }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + t);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      gain.gain.linearRampToValueAtTime(0.4,  ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + dur);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + dur + 0.05);
    });
  } catch(e) { console.warn('Som:', e); }
}

// ── FCM: pede permissão e registra token ─────────
// Retorna: 'ok' | 'negado' | 'indisponivel' | 'erro'
let _onMessageRegistrado = false;
async function iniciarPushNotifications() {
  if (!_messaging) return 'indisponivel';
  if (!FCM_VAPID_KEY) { console.warn('Push desativado: falta a chave VAPID.'); return 'indisponivel'; }
  if (!('Notification' in window)) return 'indisponivel';
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      console.warn('Notificação negada pelo usuário.');
      atualizarBotaoPush();
      return 'negado';
    }
    const reg = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
    _fcmToken = await _messaging.getToken({ vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: reg });
    if (_fcmToken) {
      // Salva o token no Firestore para uso futuro
      await db.collection('_config').doc('fcmTokens').set(
        { [_fcmToken]: true }, { merge: true }
      );
      console.log('FCM token registrado.');
    }
    // Mensagens quando app está em foreground
    if (!_onMessageRegistrado) {
      _onMessageRegistrado = true;
      _messaging.onMessage(payload => {
        const { title, body } = payload.notification || {};
        tocarSomNotificacao();
        if (title) {
          const n = payload.notification;
          adicionarNotifUI({ nome: n.body || '', servico: '', data: '', hora: '', ts: Date.now(), lida: false, id: Date.now().toString() });
        }
      });
    }
    atualizarBotaoPush();
    return _fcmToken ? 'ok' : 'erro';
  } catch(e) {
    console.warn('Erro FCM:', e);
    return 'erro';
  }
}

// Mostra o botão só quando as notificações ainda não estão ativas
function atualizarBotaoPush() {
  const btn = document.getElementById('btn-ativar-push');
  if (!btn) return;
  const ativo = ('Notification' in window) && Notification.permission === 'granted' && !!_fcmToken;
  btn.style.display = ativo ? 'none' : 'inline-block';
}

// Chamado pelo toque no botão "Ativar notificações"
async function ativarNotificacoes() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const instalado = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (ios && !instalado) {
    showToast('No iPhone: toque em Compartilhar > Adicionar à Tela de Início e abra o painel pelo ícone.', 8000);
    return;
  }
  if (!('Notification' in window)) {
    showToast('Este navegador não suporta notificações.', 6000);
    return;
  }
  if (Notification.permission === 'denied') {
    showToast('Notificações bloqueadas. Ative em Ajustes > Notificações do aparelho.', 8000);
    return;
  }
  const r = await iniciarPushNotifications();
  if (r === 'ok') showToast('Notificações ativadas!');
  else if (r === 'negado') showToast('Permissão negada. Ative em Ajustes > Notificações.', 7000);
  else showToast('Não foi possível ativar as notificações neste aparelho.', 6000);
  atualizarBotaoPush();
}

function adicionarNotifUI(notif) {
  _notificacoes.unshift(notif);
  atualizarBadgeNotif();
  renderNotifPanel();
}

// Solicita permissão de notificação ao iniciar o admin
function solicitarPermissaoNotificacao() {
  // No iPhone o pedido só funciona a partir de um toque: use o botão "Ativar notificações"
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return;
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ── ATENDIMENTO AVULSO (walk-in) ─────────────────────────────────────

async function abrirModalAvulso() {
  // Garante que os clientes estejam carregados para o autocomplete
  if (!Object.keys(_clientesFirestore).length) {
    try { await carregarClientesFirestore(); } catch(e) {}
  }

  const modal = document.getElementById('avulso-modal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Preenche o select de serviços
  const sel = document.getElementById('avulso-servico');
  {
    while (sel.options.length > 1) sel.remove(1);   // recria com os preços atuais
    SERVICES.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name + ' — R$' + s.price.toFixed(2).replace('.', ',');
      opt.dataset.price = s.price;
      opt.dataset.name  = s.name;
      sel.appendChild(opt);
    });
  }

  // Data e hora padrão = agora
  const now  = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const hh   = String(now.getHours()).padStart(2, '0');
  const mi   = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('avulso-data').value = yyyy + '-' + mm + '-' + dd;
  document.getElementById('avulso-hora').value = hh + ':' + mi;

  // Limpa campos
  document.getElementById('avulso-cliente').value = '';
  document.getElementById('avulso-tel').value     = '';
  document.getElementById('avulso-preco').value   = '';
  document.getElementById('avulso-obs').value     = '';
  document.getElementById('avulso-servico').value = '';
  document.getElementById('avulso-sugestoes').style.display = 'none';
  document.getElementById('avulso-preview').style.display   = 'none';
  document.getElementById('avulso-status').style.display    = 'none';

  const btn = document.getElementById('avulso-btn-salvar');
  btn.textContent = 'Registrar Atendimento';
  btn.disabled = false;

  setTimeout(() => document.getElementById('avulso-cliente').focus(), 100);
}

function fecharModalAvulso() {
  document.getElementById('avulso-modal').style.display = 'none';
  document.body.style.overflow = '';
}

// Fecha modal ao clicar no backdrop
document.getElementById('avulso-modal') && document.getElementById('avulso-modal').addEventListener('click', function(e) {
  if (e.target === this) fecharModalAvulso();
});

function avulsoBuscarCliente(q) {
  const sug = document.getElementById('avulso-sugestoes');
  if (!q || q.length < 2) { sug.style.display = 'none'; return; }
  const lower = q.toLowerCase();
  const matches = Object.values(_clientesFirestore)
    .filter(c => c.nome && c.nome.toLowerCase().includes(lower))
    .slice(0, 6);
  if (!matches.length) { sug.style.display = 'none'; return; }
  sug.style.display = 'block';
  sug.innerHTML = matches.map(c => `
    <div onclick="avulsoSelecionarCliente('${encodeURIComponent(c.nome)}','${(c.telefone||'').replace(/\D/g,'')}' )"
      style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;transition:background .15s;"
      onmouseover="this.style.background='#202020'" onmouseout="this.style.background='transparent'">
      <div style="width:30px;height:30px;border-radius:50%;background:#422A24;border:1px solid #543731;display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',Georgia,serif;font-size:14px;color:#8D7670;flex-shrink:0;">${(c.nome||'?')[0].toUpperCase()}</div>
      <div>
        <div style="font-family:'Oswald',sans-serif;font-size:13px;color:#F1EAD6;">${c.nome}</div>
        <div style="font-family:'Roboto',sans-serif;font-size:11px;color:#80544C;">${c.telefone || ''}</div>
      </div>
    </div>
  `).join('');
}

function avulsoSelecionarCliente(nomeEnc, tel) {
  const nome = decodeURIComponent(nomeEnc);
  document.getElementById('avulso-cliente').value = nome;
  document.getElementById('avulso-tel').value     = tel;
  document.getElementById('avulso-sugestoes').style.display = 'none';
  avulsoAtualizarPreview();
}

function avulsoPreencherPreco() {
  const sel = document.getElementById('avulso-servico');
  const opt = sel.options[sel.selectedIndex];
  if (opt && opt.dataset.price) {
    document.getElementById('avulso-preco').value = opt.dataset.price;
  }
  avulsoAtualizarPreview();
}

function avulsoAtualizarPreview() {
  const nome    = document.getElementById('avulso-cliente').value.trim();
  const sel     = document.getElementById('avulso-servico');
  const svcName = sel.options[sel.selectedIndex]?.dataset?.name || sel.value;
  const preco   = parseFloat(document.getElementById('avulso-preco').value) || 0;
  const data    = document.getElementById('avulso-data').value;
  const hora    = document.getElementById('avulso-hora').value;
  const obs     = document.getElementById('avulso-obs').value.trim();

  const preview = document.getElementById('avulso-preview');
  if (!nome && !svcName) { preview.style.display = 'none'; return; }

  preview.style.display = 'block';
  const dataFmt = data ? data.split('-').reverse().join('/') : '--';
  const items = [
    { l: 'Cliente',  v: nome   || '--' },
    { l: 'Serviço',  v: svcName || '--' },
    { l: 'Valor',    v: preco ? 'R$' + preco.toFixed(2).replace('.', ',') : '--' },
    { l: 'Data',     v: dataFmt + (hora ? ' às ' + hora : '') },
    ...(obs ? [{ l: 'Obs', v: obs }] : []),
  ];
  document.getElementById('avulso-preview-body').innerHTML = items.map(i => `
    <div>
      <div style="font-family:'Oswald',sans-serif;font-size:8px;letter-spacing:2px;color:#80544C;text-transform:uppercase;margin-bottom:2px;">${i.l}</div>
      <div style="font-family:'Roboto',sans-serif;font-size:12px;color:#D1C3BF;">${i.v}</div>
    </div>
  `).join('');
}

// Atualiza preview em tempo real nos outros campos
['avulso-cliente','avulso-preco','avulso-data','avulso-hora','avulso-obs'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', avulsoAtualizarPreview);
});

async function salvarAtendimentoAvulso() {
  const nome   = document.getElementById('avulso-cliente').value.trim();
  const tel    = document.getElementById('avulso-tel').value.trim();
  const sel    = document.getElementById('avulso-servico');
  const svcOpt = sel.options[sel.selectedIndex];
  const svcName = svcOpt?.dataset?.name || sel.value;
  const preco   = parseFloat(document.getElementById('avulso-preco').value) || 0;
  const data    = document.getElementById('avulso-data').value;
  const hora    = document.getElementById('avulso-hora').value;
  const obs     = document.getElementById('avulso-obs').value.trim();

  const statusEl = document.getElementById('avulso-status');
  function mostrarErro(msg) {
    statusEl.style.display = 'block';
    statusEl.style.background = 'rgba(176,48,48,0.1)';
    statusEl.style.color = '#d45a5a';
    statusEl.style.border = '1px solid rgba(176,48,48,0.25)';
    statusEl.textContent = msg;
  }

  if (!nome)    { mostrarErro('Informe o nome do cliente.'); return; }
  if (!svcName) { mostrarErro('Selecione um serviço.'); return; }
  if (!data)    { mostrarErro('Informe a data do atendimento.'); return; }

  const btn = document.getElementById('avulso-btn-salvar');
  btn.textContent = 'Salvando...';
  btn.disabled = true;
  statusEl.style.display = 'none';

  try {
    const payload = {
      cliente:     nome,
      telefone:    tel || '',
      servico:     svcName,
      preco:       preco,
      data:        data,
      horario:     hora || '',
      status:      'agendado',   // a regra do Firestore só aceita 'agendado' na criação; concluído logo abaixo
      origem:      'avulso',
      obs:         obs,
      criadoEm:    firebase.firestore.FieldValue.serverTimestamp(),
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    };

    // 1) cria como agendado (passa na regra de create)
    const ref = await db.collection('agendamentos').add(payload);
    // 2) marca como concluído (o admin logado pode atualizar o status)
    await ref.update({ status: 'concluido', atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() });

    // Atualiza histórico do cliente no Firestore (se tiver telefone)
    if (tel) {
      const clienteRef = db.collection('clientes').doc(tel);
      await clienteRef.set({ nome, telefone: tel }, { merge: true });
    }

    // Feedback de sucesso
    statusEl.style.display = 'block';
    statusEl.style.background = 'rgba(31,158,84,0.1)';
    statusEl.style.color = '#2db866';
    statusEl.style.border = '1px solid rgba(31,158,84,0.25)';
    statusEl.textContent = '✓ Atendimento registrado com sucesso!';
    btn.textContent = '✓ Registrado';

    setTimeout(() => fecharModalAvulso(), 1400);

  } catch(e) {
    mostrarErro('Erro ao salvar: ' + (e.message || e));
    btn.textContent = 'Registrar Atendimento';
    btn.disabled = false;
  }
}

// Fecha ao pressionar ESC
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('avulso-modal')?.style.display === 'flex') fecharModalAvulso();
  }
});

// Botão flutuante: aparece só na aba de agendamentos/dashboard no mobile
function gerenciarFab(tab) {
  const fab = document.getElementById('btn-avulso-fab');
  if (!fab) return;
  fab.style.display = (tab === 'agendamentos' || tab === 'dashboard') ? 'flex' : 'none';
}

// Registro do Service Worker (PWA)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .then(reg => console.log("SW registrado:", reg.scope))
      .catch(err => console.warn("SW falhou:", err));
  });
}

// Inicia push notifications após login
document.addEventListener('click', function unlockOnce() {
  if (!auth.currentUser) return; // espera o login para salvar o token
  document.removeEventListener('click', unlockOnce);
  iniciarPushNotifications();
});
