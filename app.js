// ============================================================
// CONFIGURATION SUPABASE
// ============================================================
const SUPABASE_URL = 'https://sdfaoloncvwrximuxcqh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkZmFvbG9uY3Z3cnhpbXV4Y3FoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjQzMjIsImV4cCI6MjA5NzIwMDMyMn0.H3I7trLzEXNseMTXn8-r8CBAORMgeKf_-xiMTU0txzU';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// ============================================================
// GÉNÉRATEUR D'IDENTIFIANT UNIQUE (compatible HTTP et HTTPS)
// ============================================================
function generateUUID() {
  // Si crypto.randomUUID existe et fonctionne, on l'utilise
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return generateUUID();
    } catch (e) {
      // Si ça plante, on passe à la méthode manuelle ci-dessous
    }
  }
  // Méthode manuelle qui marche partout
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ===== STATE =====
let currentPractitioner = null;
let patients = [];
let programs = [];
let library = [];
let messages = [];
let currentPatientId = null;
let editingPatientId = null;
let editingProgId = null;
let editingExId = null;
let exercisesInBuilder = [];
let realtimeChannels = [];
let notifRealtimeStarted = false;
let notificationsCache = [];
let flagQuestionsSettings = [];
let deletedFlagQuestionIds = [];
let currentAssessmentPathologyId = null;
let currentAssessmentPathologyName = '';
let assessmentTemplate = {
  id: null,
  title: 'Bilan de la pathologie',
  sections: []
};
let assessmentHistoryCache = [];
let pathologyFlagsQuestions = [];
let currentPathologyFlagsQuestionnaireId = null;
let pathosList = [];
let toastTimer;
const MUSCLES_LIST = [
  'Quadriceps','Ischio-jambiers','Grand Fessier','Moyen-Fessier','Adducteurs','Intrinsèques du pied','Triceps sural','Tibial ant.','Fibulaires','Long fléchisseur de l hallux','Pectoraux','Deltoïde antérieur','Deltoïde moyen','Deltoïde postérieur','Trapèze supérieur','Fixateurs de la scapula','Coiffe des rotateurs','Grand Rond','Grand dorsal','Biceps brachial','Triceps brachial','Avant-bras','Grands droits de l abdomen','Obliques','Transverse','Spinaux','Muscles cervicaux','Ilio-Psoas','Diaphragme','Extenseurs du poignet','Fléchisseurs du poignet','Abducteurs du poignet','Adducteurs du poignet','Supinateurs','Pronateurs','Muscles intrinsèques de la main'
];

let selectedMuscles = [];
let promsCache = [];


// ===== AUTH =====
async function isEmailAuthorized(email){
  const { data, error } = await db
    .from('authorized_practitioners')
    .select('email')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function doLogin(){
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPwd').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtnEl');

  errEl.style.display = 'none';
  errEl.textContent = '';

  if (!email || password.length < 8) {
    errEl.textContent = 'Email valide et mot de passe de 8 caractères minimum requis.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  const oldHtml = btn.innerHTML;
  btn.innerHTML = '<span class="loading-spinner"></span> Connexion...';

  try {
    let authData = null;

    // ÉTAPE 1 : On essaie de se connecter
    const loginResult = await db.auth.signInWithPassword({ email, password });

    if (loginResult.error) {
      const msg = loginResult.error.message || '';

      if (msg.includes('Invalid login credentials')) {
        // Le compte n'existe pas encore → on tente de le créer
        // Si l'email n'est pas autorisé, le hook serveur va bloquer
        // et signUp() retournera une erreur avec notre message personnalisé
        const signupResult = await db.auth.signUp({ email, password });

        if (signupResult.error) {
          // Ici l'erreur peut venir :
          // - du hook (email non autorisé) → message : "Cet email n'est pas autorisé..."
          // - de Supabase Auth (mot de passe trop court, email invalide, etc.)
          throw signupResult.error;
        }

        // ✅ Inscription réussie, le hook a validé l'email
        authData = signupResult.data;

        // Cas particulier : Supabase peut demander une confirmation par email
        // Si c'est le cas, user sera null mais session aussi
        if (!authData.user && !authData.session) {
          errEl.textContent = 'Un email de confirmation a été envoyé. Vérifiez votre boîte mail.';
          errEl.style.display = 'block';
          return; // On arrête ici, l'utilisateur doit confirmer son email
        }

      } else {
        // Autre type d'erreur (compte bloqué, email non confirmé, etc.)
        throw loginResult.error;
      }

    } else {
      // ✅ Connexion réussie directement
      authData = loginResult.data;
    }

    const user = authData.user;
    if (!user) throw new Error('Utilisateur introuvable après authentification.');

    // Récupération ou création du profil praticien (inchangé)
    let { data: practitioner, error: profileError } = await db
      .from('practitioners')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!practitioner) {
      const { data: created, error: createError } = await db
        .from('practitioners')
        .insert({
          id: user.id,
          email: user.email,
          first_name: '',
          last_name: '',
          speciality: '',
          cabinet: ''
        })
        .select()
        .single();
      if (createError) throw createError;
      practitioner = created;
    }

    currentPractitioner = practitioner;
    showBackoffice();
    await loadAllData();
    setupRealtimeSubscriptions();

  } catch(e) {
    console.error('Erreur login:', e);
    // On affiche le message d'erreur tel quel — s'il vient du hook,
    // ce sera notre message personnalisé "Cet email n'est pas autorisé..."
    errEl.textContent = 'Erreur : ' + (e.message || 'Une erreur est survenue.');
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldHtml;
  }
}

document.getElementById('loginPwd').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

async function doLogout(){
  realtimeChannels.forEach(ch => db.removeChannel(ch));
  realtimeChannels = [];
  notifRealtimeStarted = false;

  await db.auth.signOut();

  currentPractitioner = null;
  patients = [];
  programs = [];
  library = [];

  showLogin();
}

async function tryAutoLogin(){
  try {
    const { data: { session }, error } = await db.auth.getSession();
    if (error) throw error;
    if (!session || !session.user) { showLogin(); return; }

    const { data: practitioner, error: profileError } = await db
      .from('practitioners')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!practitioner) { showLogin(); return; }

    currentPractitioner = practitioner;
    showBackoffice();
    await loadAllData();
    setupRealtimeSubscriptions();
  } catch(e) {
    console.error('Erreur auto-login:', e);
    showLogin();
  }
}

// ===== LOAD DATA =====
async function loadAllData(){
  try {
    const pid = currentPractitioner.id;

    const { data: pats, error: e1 } = await db
  .from('patients')
  .select('*')
  .eq('practitioner_id', pid)
  .order('created_at', { ascending: false });

if (e1) throw new Error('Erreur chargement patients : ' + e1.message);

const patientIds = (pats || []).map(p => p.id);

let programsQuery = db
  .from('programs')
  .select('*');

if(patientIds.length){
  programsQuery = programsQuery.or(
    `practitioner_id.eq.${pid},patient_id.in.(${patientIds.join(',')})`
  );
} else {
  programsQuery = programsQuery.eq('practitioner_id', pid);
}

const [
  { data: progs, error: e2 },
  { data: lib,   error: e3 },
  { data: flags, error: e4 }
] = await Promise.all([
  programsQuery.order('created_at', { ascending: false }),

  db.from('exercises_library')
  .select('*')
  .or(`practitioner_id.eq.${pid},is_public.eq.true`)
  .order('created_at', { ascending: false }),

  db.from('flag_questions')
    .select('*')
    .eq('practitioner_id', pid)
    .order('position', { ascending:true })
]);

    if (e1) throw new Error('Erreur chargement patients : ' + e1.message);
    if (e2) throw new Error('Erreur chargement programmes : ' + e2.message);
    if (e3) throw new Error('Erreur chargement bibliothèque : ' + e3.message);if (e4) throw new Error('Erreur chargement questions flags : ' + e4.message);
    if (e4) throw new Error('Erreur chargement questions flags : ' + e4.message);

        patients = pats || [];
    programs = progs || [];
    library  = lib  || [];
    flagQuestionsSettings = flags || [];

    await loadPathos();

if(!flagQuestionsSettings.length){
  await createDefaultFlagQuestions();
} else {
  renderFlagQuestionsSettings();
}

    renderPatients();
    renderPrograms();
    renderLibrary();
    await refreshDashboard();

  } catch(e) {
    console.error('loadAllData error:', e);
    showToast('Erreur de chargement des données. Vérifiez votre connexion.', 'red');
  }
}

async function createDefaultFlagQuestions(){
  const defaults = [
    {
      question: 'Douleur thoracique, essoufflement inhabituel ou malaise récent ?',
      flag_type: 'red',
      position: 1
    },
    {
      question: 'Fièvre, frissons, infection récente ou altération importante de l’état général ?',
      flag_type: 'red',
      position: 2
    },
    {
      question: 'Perte de force brutale ou trouble neurologique récent ?',
      flag_type: 'red',
      position: 3
    },
    {
      question: 'Douleur nocturne inhabituelle non soulagée par le repos ?',
      flag_type: 'red',
      position: 4
    },
    {
      question: 'Traumatisme récent important ou chute récente ?',
      flag_type: 'red',
      position: 5
    },
    {
      question: 'Douleur qui augmente rapidement depuis quelques jours ?',
      flag_type: 'yellow',
      position: 6
    },
    {
      question: 'Peur importante de bouger ou appréhension forte des exercices ?',
      flag_type: 'yellow',
      position: 7
    },
    {
      question: 'Stress, anxiété ou sommeil très perturbé actuellement ?',
      flag_type: 'yellow',
      position: 8
    }
  ].map(q => ({
    ...q,
    practitioner_id: currentPractitioner.id,
    is_active: true
  }));

  const { data, error } = await db
    .from('flag_questions')
    .insert(defaults)
    .select()
    .order('position', { ascending:true });

  if(error){
    console.error('Erreur création questions par défaut:', error);
    return;
  }

  flagQuestionsSettings = data || [];
  renderFlagQuestionsSettings();
}

function renderFlagQuestionsSettings(){
  const box = document.getElementById('flagQuestionsSettings');
  if(!box) return;

  const redQuestions = flagQuestionsSettings
    .map((q, originalIndex) => ({ ...q, originalIndex }))
    .filter(q => q.flag_type === 'red');

  const yellowQuestions = flagQuestionsSettings
    .map((q, originalIndex) => ({ ...q, originalIndex }))
    .filter(q => q.flag_type !== 'red');

  const activeCount = flagQuestionsSettings.filter(q => q.is_active !== false).length;

  box.innerHTML = `
    <div style="
      margin-top:14px;
      padding:10px 12px;
      background:var(--bg);
      border:1px solid var(--border);
      border-radius:12px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      flex-wrap:wrap;
      font-size:12px;
      color:var(--text2);
    ">
      <div>
        <strong style="color:var(--text)">${flagQuestionsSettings.length}</strong> question(s) au total ·
        <strong style="color:var(--green)">${activeCount}</strong> active(s)
      </div>
      <div style="font-size:11px;color:var(--text3)">
        Glissez mentalement l’ordre avec les flèches ↑ ↓
      </div>
    </div>

    <div class="flags-settings-wrap">
      ${renderFlagColumn('red', 'Red flags', 'Signes nécessitant vigilance / orientation', redQuestions)}
      ${renderFlagColumn('yellow', 'Yellow flags', 'Facteurs psycho-sociaux / adhésion', yellowQuestions)}
    </div>
  `;
}
function renderFlagColumn(type, title, subtitle, list){
  const icon = type === 'red' ? 'fa-triangle-exclamation' : 'fa-circle-exclamation';
  const color = type === 'red' ? 'var(--red)' : 'var(--orange)';

  return `
    <div class="flags-column">
      <div class="flags-column-header">
        <div>
          <div class="flags-column-title">
            <i class="fa-solid ${icon}" style="color:${color}"></i>
            ${title}
          </div>
          <div class="flags-column-sub">${subtitle}</div>
        </div>
        <span class="badge ${type === 'red' ? 'badge-red' : 'badge-orange'}">
          ${list.length}
        </span>
      </div>

      <div class="flags-list">
        ${
          list.length
            ? list.map((q, localIndex) => renderFlagQuestionCard(q, localIndex)).join('')
            : `<div class="flags-empty">Aucune question dans cette catégorie.</div>`
        }
      </div>
    </div>
  `;
}

function renderFlagQuestionCard(q, localIndex){
  const type = q.flag_type === 'red' ? 'red' : 'yellow';
  const icon = type === 'red' ? 'fa-triangle-exclamation' : 'fa-circle-exclamation';
  const idx = q.originalIndex;

  return `
    <div class="flag-question-card ${type}">
      <div class="flag-question-top">
        <div class="flag-question-number ${type}">
          ${localIndex + 1}
        </div>

        <span class="badge ${type === 'red' ? 'badge-red' : 'badge-orange'}">
          <i class="fa-solid ${icon}"></i>
          ${type === 'red' ? 'Red' : 'Yellow'}
        </span>

        <div class="flag-question-actions">
          <button class="btn btn-secondary btn-sm btn-icon-only" onclick="moveFlagQuestion(${idx}, -1)" title="Monter">
            <i class="fa-solid fa-arrow-up"></i>
          </button>

          <button class="btn btn-secondary btn-sm btn-icon-only" onclick="moveFlagQuestion(${idx}, 1)" title="Descendre">
            <i class="fa-solid fa-arrow-down"></i>
          </button>

          <button class="btn btn-secondary btn-sm btn-icon-only" onclick="duplicateFlagQuestion(${idx})" title="Dupliquer">
            <i class="fa-solid fa-copy"></i>
          </button>

          <button class="btn btn-danger btn-sm btn-icon-only" onclick="removeFlagQuestionDraft(${idx})" title="Supprimer">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>

      <textarea class="form-textarea"
        style="min-height:70px"
        placeholder="Question à poser au patient..."
        oninput="updateFlagQuestionDraft(${idx}, 'question', this.value)">${escapeHTML(q.question || '')}</textarea>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;flex-wrap:wrap">
        <select class="form-select"
          style="max-width:145px"
          onchange="updateFlagQuestionDraft(${idx}, 'flag_type', this.value); renderFlagQuestionsSettings();">
          <option value="red" ${q.flag_type === 'red' ? 'selected' : ''}>Red flag</option>
          <option value="yellow" ${q.flag_type === 'yellow' ? 'selected' : ''}>Yellow flag</option>
        </select>

        <label class="flag-question-status">
          <input type="checkbox"
            ${q.is_active !== false ? 'checked' : ''}
            onchange="updateFlagQuestionDraft(${idx}, 'is_active', this.checked); renderFlagQuestionsSettings();">
          Question active
        </label>
      </div>
    </div>
  `;
}

function updateFlagQuestionDraft(index, key, value){
  if(!flagQuestionsSettings[index]) return;
  flagQuestionsSettings[index][key] = value;
}

function addFlagQuestionDraft(type = 'yellow'){
  flagQuestionsSettings.push({
    id: null,
    practitioner_id: currentPractitioner.id,
    question: '',
    flag_type: type === 'red' ? 'red' : 'yellow',
    is_active: true,
    position: flagQuestionsSettings.length + 1
  });

  renderFlagQuestionsSettings();
}
function moveFlagQuestion(index, dir){
  const newIndex = index + dir;
  if(newIndex < 0 || newIndex >= flagQuestionsSettings.length) return;

  [flagQuestionsSettings[index], flagQuestionsSettings[newIndex]] =
    [flagQuestionsSettings[newIndex], flagQuestionsSettings[index]];

  flagQuestionsSettings = flagQuestionsSettings.map((q, i) => ({
    ...q,
    position: i + 1
  }));

  renderFlagQuestionsSettings();
}

function duplicateFlagQuestion(index){
  const q = flagQuestionsSettings[index];
  if(!q) return;

  flagQuestionsSettings.splice(index + 1, 0, {
    ...q,
    id: null,
    question: q.question + ' copie',
    position: index + 2
  });

  flagQuestionsSettings = flagQuestionsSettings.map((q, i) => ({
    ...q,
    position: i + 1
  }));

  renderFlagQuestionsSettings();
}

async function resetDefaultFlagQuestions(){
  if(!confirm('Réinitialiser avec les questions par défaut ? Les questions actuelles seront remplacées.')) return;

  try {
    const { error } = await db
      .from('flag_questions')
      .delete()
      .eq('practitioner_id', currentPractitioner.id);

    if(error) throw error;

    flagQuestionsSettings = [];
    deletedFlagQuestionIds = [];

    await createDefaultFlagQuestions();

    showToast('Questionnaire réinitialisé', 'green');

  } catch(e) {
    console.error(e);
    showToast('Erreur : ' + e.message, 'red');
  }
}

function removeFlagQuestionDraft(index){
  if(!confirm('Supprimer cette question ?')) return;

  const q = flagQuestionsSettings[index];

  if(q && q.id){
    deletedFlagQuestionIds.push(q.id);
  }

  flagQuestionsSettings.splice(index, 1);

  flagQuestionsSettings = flagQuestionsSettings.map((q, i) => ({
    ...q,
    position: i + 1
  }));

  renderFlagQuestionsSettings();
}

async function saveFlagQuestionsSettings(){
  if(!currentPractitioner) return;

  const cleaned = flagQuestionsSettings
    .map((q, i) => ({
      id: q.id || null,
      practitioner_id: currentPractitioner.id,
      question: String(q.question || '').trim(),
      flag_type: q.flag_type === 'red' ? 'red' : 'yellow',
      is_active: q.is_active !== false,
      position: i + 1
    }))
    .filter(q => q.question.length > 0);

  if(!cleaned.length){
    showToast('Ajoutez au moins une question', 'red');
    return;
  }

  try {
    if(deletedFlagQuestionIds.length){
  const { error: deleteError } = await db
    .from('flag_questions')
    .delete()
    .in('id', deletedFlagQuestionIds)
    .eq('practitioner_id', currentPractitioner.id);

  if(deleteError) throw deleteError;
}

    for(const q of cleaned){
      if(q.id){
        const { error } = await db
          .from('flag_questions')
          .update({
            question: q.question,
            flag_type: q.flag_type,
            is_active: q.is_active,
            position: q.position
          })
          .eq('id', q.id)
          .eq('practitioner_id', currentPractitioner.id);

        if(error) throw error;
      } else {
        const { data, error } = await db
          .from('flag_questions')
          .insert({
            practitioner_id: currentPractitioner.id,
            question: q.question,
            flag_type: q.flag_type,
            is_active: q.is_active,
            position: q.position
          })
          .select()
          .single();

        if(error) throw error;

        q.id = data.id;
      }
    }

    const { data: refreshed, error: refreshError } = await db
      .from('flag_questions')
      .select('*')
      .eq('practitioner_id', currentPractitioner.id)
      .order('position', { ascending: true });

    if(refreshError) throw refreshError;

    flagQuestionsSettings = refreshed || [];
    renderFlagQuestionsSettings();
    deletedFlagQuestionIds = [];

    showToast('Questionnaire sauvegardé !', 'green');

  } catch(e) {
    console.error('Erreur sauvegarde flags:', e);
    showToast('Erreur : ' + e.message, 'red');
  }
}

// ============================================================
// FLAGS SPÉCIFIQUES PAR PATHOLOGIE
// ============================================================

async function openPathologyFlagsModal(pathologyId, pathologyName){
  document.getElementById('pathologyFlagsPathologyId').value = pathologyId;
  document.getElementById('pathologyFlagsTitle').textContent =
    'Red / Yellow Flags : ' + pathologyName;

  currentPathologyFlagsQuestionnaireId = null;
  pathologyFlagsQuestions = [];

  document.getElementById('pathologyFlagsQuestionnaireTitle').value =
    'Questionnaire Red / Yellow Flags';

  document.getElementById('pathologyFlagsVersion').value = 'v1';

  try {
    const { data, error } = await db
      .from('pathology_flag_questionnaires')
      .select('*')
      .eq('practitioner_id', currentPractitioner.id)
      .eq('pathology_id', pathologyId)
      .eq('is_active', true)
      .order('created_at', { ascending:false })
      .limit(1)
      .maybeSingle();

    if(error) throw error;

    if(data){
      currentPathologyFlagsQuestionnaireId = data.id;

      document.getElementById('pathologyFlagsQuestionnaireTitle').value =
        data.title || 'Questionnaire Red / Yellow Flags';

      document.getElementById('pathologyFlagsVersion').value =
        data.version || 'v1';

      pathologyFlagsQuestions = Array.isArray(data.questions)
        ? data.questions
        : [];
    } else {
      // Si aucune version spécifique n'existe,
      // on initialise avec le questionnaire global du praticien.
      pathologyFlagsQuestions = (flagQuestionsSettings || []).map(q => ({
        question: q.question || '',
        flag_type: q.flag_type === 'red' ? 'red' : 'yellow',
        is_active: q.is_active !== false,
        position: q.position || 0
      }));
    }

    pathologyFlagsQuestions = pathologyFlagsQuestions.map((q, i) => ({
      question: q.question || '',
      flag_type: q.flag_type === 'red' ? 'red' : 'yellow',
      is_active: q.is_active !== false,
      position: q.position || i + 1
    }));

    renderPathologyFlagsBuilder();
    // Charge les modèles disponibles dans le sélecteur
await loadFlagTemplates();

openModal('modalPathologyFlags');

    openModal('modalPathologyFlags');

  } catch(e) {
    console.error('Erreur ouverture questionnaire pathologie:', e);
    showToast('Erreur chargement questionnaire pathologie : ' + e.message, 'red');
  }
}

function renderPathologyFlagsBuilder(){
  const box = document.getElementById('pathologyFlagsBuilder');
  if(!box) return;

  const redQuestions = pathologyFlagsQuestions
    .map((q, originalIndex) => ({ ...q, originalIndex }))
    .filter(q => q.flag_type === 'red');

  const yellowQuestions = pathologyFlagsQuestions
    .map((q, originalIndex) => ({ ...q, originalIndex }))
    .filter(q => q.flag_type !== 'red');

  const activeCount = pathologyFlagsQuestions
    .filter(q => q.is_active !== false)
    .length;

  box.innerHTML = `
    <div style="
      margin-top:14px;
      padding:10px 12px;
      background:var(--bg);
      border:1px solid var(--border);
      border-radius:12px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      flex-wrap:wrap;
      font-size:12px;
      color:var(--text2);
    ">
      <div>
        <strong style="color:var(--text)">${pathologyFlagsQuestions.length}</strong> question(s) au total ·
        <strong style="color:var(--green)">${activeCount}</strong> active(s)
      </div>
      <div style="font-size:11px;color:var(--text3)">
        Questionnaire spécifique à cette pathologie
      </div>
    </div>

    <div class="flags-settings-wrap">
      ${renderPathologyFlagColumn(
        'red',
        'Red flags',
        'Signes nécessitant vigilance / orientation',
        redQuestions
      )}
      ${renderPathologyFlagColumn(
        'yellow',
        'Yellow flags',
        'Facteurs psycho-sociaux / adhésion',
        yellowQuestions
      )}
    </div>
  `;
}

function renderPathologyFlagColumn(type, title, subtitle, list){
  const icon = type === 'red'
    ? 'fa-triangle-exclamation'
    : 'fa-circle-exclamation';

  const color = type === 'red'
    ? 'var(--red)'
    : 'var(--orange)';

  return `
    <div class="flags-column">
      <div class="flags-column-header">
        <div>
          <div class="flags-column-title">
            <i class="fa-solid ${icon}" style="color:${color}"></i>
            ${title}
          </div>
          <div class="flags-column-sub">${subtitle}</div>
        </div>
        <span class="badge ${type === 'red' ? 'badge-red' : 'badge-orange'}">
          ${list.length}
        </span>
      </div>

      <div class="flags-list">
        ${
          list.length
            ? list.map((q, localIndex) =>
                renderPathologyFlagQuestionCard(q, localIndex)
              ).join('')
            : `<div class="flags-empty">Aucune question dans cette catégorie.</div>`
        }
      </div>
    </div>
  `;
}

function renderPathologyFlagQuestionCard(q, localIndex){
  const type = q.flag_type === 'red' ? 'red' : 'yellow';
  const idx = q.originalIndex;

  const icon = type === 'red'
    ? 'fa-triangle-exclamation'
    : 'fa-circle-exclamation';

  return `
    <div class="flag-question-card ${type}">
      <div class="flag-question-top">
        <div class="flag-question-number ${type}">
          ${localIndex + 1}
        </div>

        <span class="badge ${type === 'red' ? 'badge-red' : 'badge-orange'}">
          <i class="fa-solid ${icon}"></i>
          ${type === 'red' ? 'Red' : 'Yellow'}
        </span>

        <div class="flag-question-actions">
          <button class="btn btn-secondary btn-sm btn-icon-only"
            onclick="movePathologyFlagQuestion(${idx}, -1)"
            title="Monter">
            <i class="fa-solid fa-arrow-up"></i>
          </button>

          <button class="btn btn-secondary btn-sm btn-icon-only"
            onclick="movePathologyFlagQuestion(${idx}, 1)"
            title="Descendre">
            <i class="fa-solid fa-arrow-down"></i>
          </button>

          <button class="btn btn-secondary btn-sm btn-icon-only"
            onclick="duplicatePathologyFlagQuestion(${idx})"
            title="Dupliquer">
            <i class="fa-solid fa-copy"></i>
          </button>

          <button class="btn btn-danger btn-sm btn-icon-only"
            onclick="removePathologyFlagQuestionDraft(${idx})"
            title="Supprimer">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>

      <textarea class="form-textarea"
        style="min-height:70px"
        placeholder="Question à poser au patient..."
        oninput="updatePathologyFlagQuestionDraft(${idx}, 'question', this.value)"
      >${escapeHTML(q.question || '')}</textarea>

      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        margin-top:8px;
        flex-wrap:wrap;
      ">
        <select class="form-select"
          style="max-width:145px"
          onchange="
            updatePathologyFlagQuestionDraft(${idx}, 'flag_type', this.value);
            renderPathologyFlagsBuilder();
          ">
          <option value="red" ${q.flag_type === 'red' ? 'selected' : ''}>Red flag</option>
          <option value="yellow" ${q.flag_type === 'yellow' ? 'selected' : ''}>Yellow flag</option>
        </select>

        <label class="flag-question-status">
          <input type="checkbox"
            ${q.is_active !== false ? 'checked' : ''}
            onchange="
              updatePathologyFlagQuestionDraft(${idx}, 'is_active', this.checked);
              renderPathologyFlagsBuilder();
            ">
          Question active
        </label>
      </div>
    </div>
  `;
}

function updatePathologyFlagQuestionDraft(index, key, value){
  if(!pathologyFlagsQuestions[index]) return;
  pathologyFlagsQuestions[index][key] = value;
}

function addPathologyFlagQuestionDraft(type = 'yellow'){
  pathologyFlagsQuestions.push({
    question: '',
    flag_type: type === 'red' ? 'red' : 'yellow',
    is_active: true,
    position: pathologyFlagsQuestions.length + 1
  });

  renderPathologyFlagsBuilder();
}

function removePathologyFlagQuestionDraft(index){
  if(!confirm('Supprimer cette question ?')) return;

  pathologyFlagsQuestions.splice(index, 1);

  pathologyFlagsQuestions = pathologyFlagsQuestions.map((q, i) => ({
    ...q,
    position: i + 1
  }));

  renderPathologyFlagsBuilder();
}

function movePathologyFlagQuestion(index, dir){
  const newIndex = index + dir;

  if(newIndex < 0 || newIndex >= pathologyFlagsQuestions.length) return;

  [pathologyFlagsQuestions[index], pathologyFlagsQuestions[newIndex]] =
    [pathologyFlagsQuestions[newIndex], pathologyFlagsQuestions[index]];

  pathologyFlagsQuestions = pathologyFlagsQuestions.map((q, i) => ({
    ...q,
    position: i + 1
  }));

  renderPathologyFlagsBuilder();
}

function duplicatePathologyFlagQuestion(index){
  const q = pathologyFlagsQuestions[index];
  if(!q) return;

  pathologyFlagsQuestions.splice(index + 1, 0, {
    question: (q.question || '') + ' copie',
    flag_type: q.flag_type === 'red' ? 'red' : 'yellow',
    is_active: q.is_active !== false,
    position: index + 2
  });

  pathologyFlagsQuestions = pathologyFlagsQuestions.map((q, i) => ({
    ...q,
    position: i + 1
  }));

  renderPathologyFlagsBuilder();
}

function copyGlobalFlagsToPathology(){
  if(!confirm('Remplacer les questions actuelles par le questionnaire global ?')) return;

  pathologyFlagsQuestions = (flagQuestionsSettings || []).map((q, i) => ({
    question: q.question || '',
    flag_type: q.flag_type === 'red' ? 'red' : 'yellow',
    is_active: q.is_active !== false,
    position: i + 1
  }));

  renderPathologyFlagsBuilder();
  showToast('Questionnaire global copié', 'green');
}

async function savePathologyFlagsQuestionnaire(){
  const pathologyId = document.getElementById('pathologyFlagsPathologyId').value;

  if(!pathologyId){
    showToast('Pathologie introuvable', 'red');
    return;
  }

  const title = document
    .getElementById('pathologyFlagsQuestionnaireTitle')
    .value
    .trim() || 'Questionnaire Red / Yellow Flags';

  const version = document
    .getElementById('pathologyFlagsVersion')
    .value
    .trim() || 'v1';

  const cleaned = pathologyFlagsQuestions
    .map((q, i) => ({
      question: String(q.question || '').trim(),
      flag_type: q.flag_type === 'red' ? 'red' : 'yellow',
      is_active: q.is_active !== false,
      position: i + 1
    }))
    .filter(q => q.question.length > 0);

  if(!cleaned.length){
    showToast('Ajoutez au moins une question', 'red');
    return;
  }

  try {
    const payload = {
      practitioner_id: currentPractitioner.id,
      pathology_id: pathologyId,
      title,
      version,
      questions: cleaned,
      is_active: true,
      updated_at: new Date().toISOString()
    };

    if(currentPathologyFlagsQuestionnaireId){
      const { error } = await db
        .from('pathology_flag_questionnaires')
        .update(payload)
        .eq('id', currentPathologyFlagsQuestionnaireId)
        .eq('practitioner_id', currentPractitioner.id);

      if(error) throw error;
    } else {
      const { data, error } = await db
        .from('pathology_flag_questionnaires')
        .insert(payload)
        .select()
        .single();

      if(error) throw error;

      currentPathologyFlagsQuestionnaireId = data.id;
    }

    pathologyFlagsQuestions = cleaned;

    showToast('Questionnaire spécifique sauvegardé', 'green');
    closeModal('modalPathologyFlags');

  } catch(e) {
    console.error('Erreur sauvegarde questionnaire pathologie:', e);
    showToast('Erreur : ' + e.message, 'red');
  }
}

// ===== REALTIME =====
function setupRealtimeSubscriptions(){
  realtimeChannels.forEach(ch => db.removeChannel(ch));
  realtimeChannels = [];

  const sessionsChannel = db.channel('sessions-changes-' + currentPractitioner.id)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'sessions'
      },
      payload => {
        handleNewSession(payload.new);
      }
    )
    .subscribe(status => {
      console.log('[Realtime] sessions:', status);
    });

  const messagesChannel = db.channel('messages-changes-' + currentPractitioner.id)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages'
      },
      payload => {
        handleNewMessage(payload.new);
      }
    )
    .subscribe(status => {
      console.log('[Realtime] messages:', status);
    });

  const patientsChannel = db.channel('patients-changes-' + currentPractitioner.id)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'patients'
      },
      () => {
        loadAllData();
      }
    )
    .subscribe(status => {
      console.log('[Realtime] patients:', status);
    });

  realtimeChannels = [sessionsChannel, messagesChannel, patientsChannel];
}


function handleNewSession(session){
  const patient = patients.find(p => p.id === session.patient_id);
  if (!patient) return;

  showToast(
    `🔔 ${patient.first_name} ${patient.last_name} vient de valider une séance !`,
    'green'
  );
  addActivityRow(patient, 'Séance validée', session.created_at);

  // ✅ Alerte rouge si EVA > 7
  if (session.eva && session.eva > 7) {
    createNotification(
      currentPractitioner.id,
      'kine',
      'alerte_rouge',
      `🚨 Alerte EVA — ${patient.first_name} ${patient.last_name}`,
      `EVA signalée à ${session.eva}/10. Contactez ce patient rapidement.`,
      { patient_id: patient.id, session_id: session.id }
    );
  }

  if (currentPatientId === session.patient_id) renderSuivi(currentPatientId);
  refreshDashboard();
}


function handleNewMessage(msg){
  if (msg.sender !== 'patient') return;
  const patient = patients.find(p => p.id === msg.patient_id);
  if (!patient) return;

  showToast(
    `💬 Nouveau message de ${patient.first_name} ${patient.last_name}`,
    'blue'
  );
  addActivityRow(patient, 'Nouveau message', msg.created_at);

  // ✅ Notification in-app pour le nouveau message
  createNotification(
    currentPractitioner.id,
    'kine',
    'nouveau_message',
    `💬 Message de ${patient.first_name} ${patient.last_name}`,
    msg.text.slice(0, 80) + (msg.text.length > 80 ? '...' : ''),
    { patient_id: patient.id }
  );

  if (currentPatientId === msg.patient_id) renderMessages(currentPatientId);
}

function addActivityRow(patient, action, date){
  const body = document.getElementById('activityBody');
  if (body.children.length === 1 && body.textContent.includes('Aucune')) body.innerHTML = '';
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><div class="patient-cell">
      <div class="patient-avatar" style="background:${getColor(patient.id)}">${getInitials(patient)}</div>
      <span style="font-weight:600;font-size:13px">${escapeHTML(patient.first_name)} ${escapeHTML(patient.last_name)}</span>
    </div></td>
    <td><span class="badge badge-blue">${escapeHTML(action)}</span></td>
    <td style="font-size:11px;color:var(--text3)">À l'instant</td>`;
  body.prepend(row);
  while (body.children.length > 8) body.removeChild(body.lastChild);
}

// ===== PATIENTS CRUD =====
const avatarColors = ['#3b82f6','#10b981','#8b5cf6','#f59e0b','#ef4444','#06b6d4','#ec4899'];
function getColor(id){ return avatarColors[parseInt((id||'0').replace(/-/g,'').slice(-2),16) % avatarColors.length] || avatarColors[0]; }
function getInitials(p){ return ((p.first_name||'?')[0] + (p.last_name||'?')[0]).toUpperCase(); }
function openNewPatient(){
  editingPatientId = null;
  document.getElementById('modalPatientTitle').textContent = 'Nouveau patient';

  // Réinitialisation de tous les champs
  ['pFirstName','pLastName','pAge','pPhone','pEmail','pNotes','pPathology']
    .forEach(id => document.getElementById(id).value = '');

  document.getElementById('pStatus').value = 'active';
  document.getElementById('pStartDate').value = new Date().toISOString().slice(0,10);
populatePatientPathologySelect('');

  // ✅ Case consentement décochée pour un nouveau patient
  document.getElementById('pConsent').checked = false;

  // ✅ On affiche le bloc consentement (peut être caché en mode édition)
  document.getElementById('consentBlock').style.display = 'block';
  document.getElementById('consentInfo').style.display = 'none';

  openModal('modalPatient');
}

function editCurrentPatient(){
  const p = patients.find(x => x.id === currentPatientId);
  if (!p) return;
  editingPatientId = p.id;

  document.getElementById('modalPatientTitle').textContent = 'Modifier';
  document.getElementById('pFirstName').value = p.first_name || '';
  document.getElementById('pLastName').value = p.last_name || '';
  document.getElementById('pAge').value = p.age || '';
  document.getElementById('pPathology').value = p.pathology || '';
  populatePatientPathologySelect(p.pathology || '');
  document.getElementById('pPhone').value = p.phone || '';
  document.getElementById('pEmail').value = p.email || '';
  document.getElementById('pStatus').value = p.status || 'active';
  document.getElementById('pStartDate').value = p.start_date || '';
  document.getElementById('pNotes').value = p.notes || '';

  // ✅ En mode édition, on masque la case à cocher
  // et on affiche à la place les infos de consentement déjà enregistrées
  document.getElementById('consentBlock').style.display = 'none';
  document.getElementById('consentInfo').style.display = 'block';

  // Affiche la date à laquelle le consentement a été donné
  const consentDate = p.consent_given_at
    ? new Date(p.consent_given_at).toLocaleDateString('fr-FR')
    : 'Non renseigné';

  document.getElementById('consentInfoText').textContent =
    p.consent_given
      ? `✅ Consentement donné le ${consentDate} (version ${p.consent_text_version || '—'})`
      : `⚠️ Aucun consentement enregistré`;

  openModal('modalPatient');
}

async function savePatient(){
  // === ÉTAPE 1 : Récupération des valeurs du formulaire ===
  const fn = document.getElementById('pFirstName').value.trim();
  const ln = document.getElementById('pLastName').value.trim();
  const path = document.getElementById('pPathology').value.trim();

  // === ÉTAPE 2 : Validations de base ===
  if (!fn || !ln) {
    showToast('Prénom et nom requis', 'red');
    return;
  }

  // === ÉTAPE 3 : Validation du consentement (création uniquement) ===
  // On lit la checkbox UNE SEULE FOIS ici
  const consentChecked = document.getElementById('pConsent').checked;

  if (!editingPatientId) {
    // On est en mode CRÉATION → le consentement est obligatoire
    if (!consentChecked) {
      showToast('Le consentement du patient est obligatoire pour créer son dossier', 'red');
      // Mise en évidence visuelle du bloc consentement
      const cb = document.getElementById('consentBlock');
      cb.style.border = '2px solid var(--red)';
      cb.style.borderRadius = '8px';
      cb.style.padding = '8px';
      setTimeout(() => {
        cb.style.border = '';
        cb.style.padding = '';
      }, 3000);
      return;
    }
  }

  // === ÉTAPE 4 : Désactivation du bouton pendant l'enregistrement ===
  const btn = document.getElementById('btnSavePat');
  btn.disabled = true;
  const origHtml = btn.innerHTML;
  btn.innerHTML = '<span class="loading-spinner" style="border-top-color:#fff"></span> Enregistrement...';

  // === ÉTAPE 5 : Construction du payload ===
  // On construit UN SEUL objet payload avec tous les champs
  const payload = {
    first_name: fn,
    last_name: ln,
    age: document.getElementById('pAge').value
      ? parseInt(document.getElementById('pAge').value, 10)
      : null,
    pathology: path,
    phone: document.getElementById('pPhone').value.trim(),
    email: document.getElementById('pEmail').value.trim().toLowerCase(),
    status: document.getElementById('pStatus').value,
    start_date: document.getElementById('pStartDate').value || null,
    notes: document.getElementById('pNotes').value,
    updated_at: new Date().toISOString()
    // ⚠️ On ne met PAS consent_given ici, on le gère juste en dessous
    // selon si on est en création ou en modification
  };

  // === ÉTAPE 6 : Champs spécifiques à la CRÉATION ===
  // Ces lignes ne s'exécutent QUE si editingPatientId est null
  if (!editingPatientId) {
    payload.consent_given = true;
    payload.consent_given_at = new Date().toISOString();
    payload.consent_text_version = 'v1-2026-06';
    payload.practitioner_id = currentPractitioner.id;
    payload.token = generateUUID();
    payload.token_expires_at = new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000
    ).toISOString(); // expire dans 90 jours
  }
  // En MODIFICATION on ne touche pas à consent_given,
  // pour ne pas effacer l'historique de consentement

  // === ÉTAPE 7 : Envoi vers Supabase ===
  try {
    if (editingPatientId) {
      // Mode MODIFICATION
      const { error } = await db
        .from('patients')
        .update(payload)
        .eq('id', editingPatientId)
        .eq('practitioner_id', currentPractitioner.id);
      if (error) throw error;
    } else {
      // Mode CRÉATION
      const { error } = await db
        .from('patients')
        .insert(payload);
      if (error) throw error;
    }

    // === ÉTAPE 8 : Succès ===
    await loadAllData();
    closeModal('modalPatient');
    showToast('Sauvegardé !');
    if (editingPatientId) showPatientDetail(editingPatientId);

  } catch(e) {
    showToast('Erreur : ' + e.message, 'red');
  } finally {
    // Toujours réactiver le bouton, même en cas d'erreur
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

async function deleteCurrentPatient(){
  if (!confirm('Supprimer ce patient et toutes ses données ? Action irréversible (RGPD).')) return;
  const { error } = await db.from('patients').delete()
    .eq('id', currentPatientId)
    .eq('practitioner_id', currentPractitioner.id);
  if (error) { showToast('Erreur : ' + error.message, 'red'); return; }
  showToast('Supprimé.');
  await loadAllData();
  showView('patients');
}

function filterPatients(){ renderPatients(document.getElementById('patientSearch').value.toLowerCase()); }

function renderPatients(q = ''){
  const body = document.getElementById('patientsBody');

  const query = String(q || '').toLowerCase();

  const filtered = patients.filter(p =>
    (
      (p.first_name || '') + ' ' +
      (p.last_name || '') + ' ' +
      (p.pathology || '')
    ).toLowerCase().includes(query)
  );

  document.getElementById('patientsBadge').textContent = patients.length;

  if(!filtered.length){
    body.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;padding:32px;color:var(--text3)">
          Aucun patient. Cliquez sur "Nouveau patient".
        </td>
      </tr>
    `;
    return;
  }

  const statusLabel = s => ({
    active: 'Actif',
    pause: 'En pause',
    done: 'Terminé'
  }[s] || s || '—');

  const statusClass = s => ({
    active: 'badge-green',
    pause: 'badge-orange',
    done: 'badge-gray'
  }[s] || 'badge-gray');

  const patProgs = id => programs.filter(p => p.patient_id === id);

  body.innerHTML = filtered.map(p => {
    const patientPrograms = patProgs(p.id);

    const programsHtml = patientPrograms.length
      ? patientPrograms.map(pr => `
          <span class="badge badge-blue">${escapeHTML(pr.name)}</span>
        `).join(' ')
      : '<span class="badge badge-gray">—</span>';

    return `
      <tr style="cursor:pointer" onclick="showPatientDetail('${p.id}')">
        <td>
          <div class="patient-cell">
            <div class="patient-avatar" style="background:${getColor(p.id)}">
              ${getInitials(p)}
            </div>
            <div>
              <div class="patient-name">
                ${escapeHTML(p.first_name)} ${escapeHTML(p.last_name)}
              </div>
              <div class="patient-patho">
                ${escapeHTML(p.pathology || '—')}
              </div>
              ${renderFlagBadge(p)}
            </div>
          </div>
        </td>

        <td>${p.age || '—'}</td>

        <td>${programsHtml}</td>

        <td>
          <span class="badge ${statusClass(p.status)}">
            ${statusLabel(p.status)}
          </span>
        </td>

        <td style="font-size:11px">
          ${p.created_at ? new Date(p.created_at).toLocaleDateString('fr-FR') : '—'}
        </td>

        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-secondary btn-sm btn-icon-only"
              onclick="event.stopPropagation();currentPatientId='${p.id}';editCurrentPatient()">
              <i class="fa-solid fa-pen"></i>
            </button>

            <button class="btn btn-danger btn-sm btn-icon-only"
              onclick="event.stopPropagation();currentPatientId='${p.id}';deleteCurrentPatient()">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderFlagBadge(p){
  if(p.last_flag_status === 'red'){
    return `
      <div class="flag-patient-alert red">
        <i class="fa-solid fa-triangle-exclamation"></i>
        Red flag
      </div>
    `;
  }

  if(p.last_flag_status === 'yellow'){
    return `
      <div class="flag-patient-alert yellow">
        <i class="fa-solid fa-circle-exclamation"></i>
        Yellow flag
      </div>
    `;
  }

  return '';
}

async function showPatientDetail(id){
  currentPatientId=id;
  const p=patients.find(x=>x.id===id);if(!p)return;
  showView('patient-detail');
  document.getElementById('topbarTitle').textContent=p.first_name+' '+p.last_name;
  const av=document.getElementById('detailAvatar');
  av.textContent=getInitials(p);av.style.background=getColor(p.id);
  document.getElementById('detailName').textContent=p.first_name+' '+p.last_name;
  document.getElementById('detailPatho').textContent=p.pathology||'—';
  const statusLabel=s=>({active:'Actif',pause:'En pause',done:'Terminé'}[s]||s);
  const statusClass=s=>({active:'badge-green',pause:'badge-orange',done:'badge-gray'}[s]||'badge-gray');
  document.getElementById('detailMeta').innerHTML=`<span class="badge ${statusClass(p.status)}">${statusLabel(p.status)}</span>`;
  document.getElementById('detailInfoRows').innerHTML=`
    <div class="info-row"><span class="info-row-label">Âge</span><span class="info-row-val">${p.age||'—'}</span></div>
    <div class="info-row"><span class="info-row-label">Tel.</span><span class="info-row-val">${p.phone||'—'}</span></div>
    <div class="info-row"><span class="info-row-label">Email</span><span class="info-row-val">${p.email||'—'}</span></div>
    <div class="info-row"><span class="info-row-label">Début</span><span class="info-row-val">${p.start_date||'—'}</span></div>`;
  const shareUrl = new URL('patient.html?token=' + encodeURIComponent(p.token), window.location.href).href;
  document.getElementById('shareBox').innerHTML=`
    <div class="share-box">
      <div style="font-size:12px;font-weight:700;color:#1e40af;margin-bottom:6px">Lien unique patient</div>
      <div class="share-link-row"><div class="share-link" id="shareUrlText">${shareUrl}</div></div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-primary btn-sm" onclick="copyLink('${shareUrl}')"><i class="fa-solid fa-copy"></i> Copier le lien</button></div>
      <div class="rgpd-notice" style="margin-top:10px"><i class="fa-solid fa-shield-halved"></i>Le lien ne contient aucune donnée nominative</div>
    </div>`;
  document.getElementById('privateNotes').value=p.private_notes||'';
  renderPatientPrograms(id);
  await renderMessages(id);
  await renderSuivi(id);
  await renderFlagScreeningDetail(id);
  switchTab(0, document.querySelector('#view-patient-detail .tabs .tab'));
}
async function renderFlagScreeningDetail(patientId){
  const box = document.getElementById('flagScreeningDetail');
  if(!box) return;

  const { data, error } = await db
    .from('patient_flag_screenings')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at', { ascending:false })
    .limit(1)
    .maybeSingle();

  if(error){
    console.error('Erreur chargement screening:', error);
    box.innerHTML = '';
    return;
  }

  if(!data){
    box.innerHTML = `
      <div class="alert alert-warn">
        <i class="fa-solid fa-circle-info"></i>
        <div>Aucun questionnaire Red / Yellow Flags rempli pour ce patient.</div>
      </div>
    `;
    return;
  }

  const status = data.has_red_flag ? 'red' : data.has_yellow_flag ? 'yellow' : 'none';

  if(status === 'none'){
    box.innerHTML = `
      <div class="alert" style="background:#ecfdf5;border:1px solid #10b981;color:#065f46">
        <i class="fa-solid fa-circle-check"></i>
        <div>
          Dernier dépistage : aucun red/yellow flag signalé.
          <br>
          <span style="font-size:11px">
            ${new Date(data.created_at).toLocaleString('fr-FR')}
          </span>
        </div>
      </div>
    `;
    return;
  }

  const answers = Array.isArray(data.answers) ? data.answers : [];

  const positiveAnswers = answers.filter(a => a.answer === true);

  box.innerHTML = `
    <div class="${status === 'red' ? 'flag-detail-card-red' : 'flag-detail-card-yellow'}">
      <div style="font-weight:800;margin-bottom:8px;display:flex;align-items:center;gap:8px">
        <i class="fa-solid ${status === 'red' ? 'fa-triangle-exclamation' : 'fa-circle-exclamation'}"></i>
        ${status === 'red' ? 'Red flag signalé' : 'Yellow flag signalé'}
      </div>

      <div style="font-size:12px;margin-bottom:8px">
        Dernier questionnaire rempli le
        <strong>${new Date(data.created_at).toLocaleString('fr-FR')}</strong>
      </div>

      <div style="background:rgba(255,255,255,.45);border-radius:10px;padding:8px">
        ${
          positiveAnswers.length
            ? positiveAnswers.map(a => `
                <div class="flag-answer-row">
                  <strong>${escapeHTML(a.flag_type.toUpperCase())}</strong>
                  — ${escapeHTML(a.question)}
                  <span class="flag-answer-yes"> Oui</span>
                </div>
              `).join('')
            : '<div style="font-size:12px">Aucune réponse positive.</div>'
        }
      </div>

      <button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="markFlagAlertRead('${patientId}')">
        <i class="fa-solid fa-check"></i>
        Marquer comme vu
      </button>
    </div>
  `;
}
async function markFlagAlertRead(patientId){
  const { error } = await db
    .from('patients')
    .update({ flag_alert_read: true })
    .eq('id', patientId)
    .eq('practitioner_id', currentPractitioner.id);

  if(error){
    showToast('Erreur : ' + error.message, 'red');
    return;
  }

  const p = patients.find(x => x.id === patientId);
  if(p) p.flag_alert_read = true;

  showToast('Alerte marquée comme vue', 'green');
  await loadAllData();
  if(currentPatientId === patientId){
    await renderFlagScreeningDetail(patientId);
  }
}

async function saveNotes(){
  const val=document.getElementById('privateNotes').value;
  await db.from('patients').update({
    private_notes: val,
    updated_at: new Date().toISOString()
  })
  .eq('id', currentPatientId)
  .eq('practitioner_id', currentPractitioner.id);
  const p=patients.find(x=>x.id===currentPatientId); if(p)p.private_notes=val;
}
function copyLink(url){navigator.clipboard.writeText(url).then(()=>showToast('Lien copié !','green'))}

// ===== PROGRAMS =====
// Liste des proms disponibles en mémoire pour le builder de programme
let availableProms = [];

async function loadAvailableProms(){
  const { data, error } = await db
    .from('prom_templates')
    .select('id,title')
    .eq('practitioner_id', currentPractitioner.id)
    .order('created_at', { ascending: false });

  if(error){ console.error(error); return; }
  availableProms = data || [];
}

function renderProgPromsContainer(selectedIds = []){
  const box = document.getElementById('progPromsContainer');
  if(!box) return;

  // Si aucune ligne, on en affiche une vide par défaut
  const rows = selectedIds.length ? selectedIds : [''];

  box.innerHTML = rows.map((val, i) => `
    <div style="display:flex;gap:8px;align-items:center">
      <select class="form-select" data-prom-index="${i}" style="flex:1">
        <option value="">-- Aucun --</option>
        ${availableProms.map(p => `
          <option value="${p.id}" ${p.id === val ? 'selected' : ''}>
            ${escapeHTML(p.title || 'Sans titre')}
          </option>
        `).join('')}
      </select>
      <button type="button" class="btn btn-danger btn-sm btn-icon-only"
              onclick="removePromRow(${i})">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `).join('');
}

function addPromToProgram(){
  const box = document.getElementById('progPromsContainer');
  const existing = getSelectedPromIds();
  renderProgPromsContainer([...existing, '']);
}

function removePromRow(index){
  const existing = getSelectedPromIds();
  existing.splice(index, 1);
  renderProgPromsContainer(existing.length ? existing : ['']);
}

function getSelectedPromIds(){
  const selects = document.querySelectorAll('[data-prom-index]');
  return Array.from(selects)
    .map(s => s.value)
    .filter(v => v !== '');
}

// Garde la compatibilité avec le reste du code
async function populateProgramPromSelect(selectedPromId = ''){
  await loadAvailableProms();
  const ids = selectedPromId ? [selectedPromId] : [];
  renderProgPromsContainer(ids);
}

async function openProgramBuilder(progId=null){
  editingProgId = progId;
  exercisesInBuilder = [];

  const modelSel = document.getElementById('modelSelector');

  const models = programs.filter(p => p.is_template === true || !p.patient_id);

  modelSel.innerHTML = '<option value="">-- Charger un programme existant --</option>' +
    models.map(m => `
      <option value="${m.id}">
        ${escapeHTML(m.name)}
      </option>
    `).join('');

  const sel = document.getElementById('progPatient');

  sel.innerHTML = '<option value="">— Sélectionner —</option>' +
    patients.map(p => `
      <option value="${p.id}">
        ${escapeHTML(p.first_name)} ${escapeHTML(p.last_name)}
      </option>
    `).join('');

  let selectedPromId = '';

  if(progId){
    const prog = programs.find(x => x.id === progId);

    if(prog){
      document.getElementById('progName').value = prog.name || '';
      document.getElementById('progPhase').value = prog.phase || 'crise';
      document.getElementById('progFreq').value = prog.frequency || '';
      document.getElementById('progDesc').value = prog.description || '';
      document.getElementById('progPatient').value = prog.patient_id || '';
      // Supporte l'ancien format (prom_id) et le nouveau (prom_ids)
const savedIds = Array.isArray(prog.prom_ids) && prog.prom_ids.length
  ? prog.prom_ids
  : prog.prom_id
    ? [prog.prom_id]
    : [];
selectedPromId = savedIds[0] || '';

      exercisesInBuilder = JSON.parse(JSON.stringify(prog.exercises || []));
    }
  } else {
    document.getElementById('progName').value = '';
    document.getElementById('progPhase').value = 'crise';
    document.getElementById('progFreq').value = '';
    document.getElementById('progDesc').value = '';
    document.getElementById('progPatient').value = currentPatientId || '';
    selectedPromId = '';
  }

  if(currentPatientId) {
    sel.value = currentPatientId;
  }

  await loadAvailableProms();

// Récupère le programme en cours d'édition s'il existe
const currentProg = progId ? programs.find(x => x.id === progId) : null;

const savedIds2 = Array.isArray(currentProg?.prom_ids) && currentProg?.prom_ids?.length
  ? currentProg.prom_ids
  : currentProg?.prom_id
    ? [currentProg.prom_id]
    : [];
renderProgPromsContainer(savedIds2);


  renderExercisesBuilder();
  openModal('modalProgram');
}

async function loadProgramFromModel(modelId) {
  if (!modelId) return;

  editingProgId = null;

  const model = programs.find(p => p.id === modelId);
  if (!model) return;

  document.getElementById('progName').value = model.name || '';
  document.getElementById('progPhase').value = model.phase || 'crise';
  document.getElementById('progFreq').value = model.frequency || '';
  document.getElementById('progDesc').value = model.description || '';

  exercisesInBuilder = JSON.parse(JSON.stringify(model.exercises || []));

  await populateProgramPromSelect(model.prom_id || '');

  renderExercisesBuilder();
  showToast('Programme chargé !', 'blue');
}

function addExercise(){
  exercisesInBuilder.push({id:'tmp'+Date.now(),name:'Nouvel exercice',series:'4',reps:'15',rest:'60-90s',tempo:'',focus:'',video:'',regression:'',progression:'',alt:'',evaTarget:'≤ 4/10'});
  renderExercisesBuilder();
}
function removeExercise(idx){exercisesInBuilder.splice(idx,1);renderExercisesBuilder()}
function renderExercisesBuilder(){
  const c=document.getElementById('exercisesContainer');
  if(!exercisesInBuilder.length){c.innerHTML=`<div style="text-align:center;padding:24px;color:var(--text3);font-size:13px">Ajoutez des exercices via les boutons ci-dessus.</div>`;return;}
  c.innerHTML=exercisesInBuilder.map((ex,i)=>`
    <div class="ex-item${ex._open?' open':''}">
      <div class="ex-item-hdr" onclick="toggleExItem(${i})">
        <i class="fa-solid fa-grip-vertical ex-drag"></i><div class="ex-num">${i+1}</div>
        <div style="flex:1"><div class="ex-item-name">${ex.name||'Exercice '+(i+1)}</div><div class="ex-item-quick">${ex.series||'?'}×${ex.reps||'?'} · ${ex.rest||'?'}</div></div>
        <button class="btn btn-danger btn-sm btn-icon-only" onclick="event.stopPropagation();removeExercise(${i})"><i class="fa-solid fa-trash"></i></button>
        <i class="fa-solid fa-chevron-down ex-chevron"></i>
      </div>
      <div class="ex-item-body">
        <div class="form-grid" style="margin-bottom:12px">
          <div class="form-group full"><label class="form-label">Nom</label><input class="form-input" value="${escapeHTML(ex.name||'')}" oninput="updateEx(${i},'name',this.value)"/></div>
          <div class="form-group full"><label class="form-label">Focus / Cue</label><textarea class="form-textarea" style="min-height:50px" oninput="updateEx(${i},'focus',this.value)">${escapeHTML(ex.focus||'')}</textarea></div>
        </div>
        <div class="dosage-row">
          <div class="dosage-mini"><label>Séries</label><input class="form-input" value="${escapeHTML(ex.series||'')}" oninput="updateEx(${i},'series',this.value)"/></div>
          <div class="dosage-mini"><label>Reps / Durée</label><input class="form-input" value="${escapeHTML(ex.reps||'')}" oninput="updateEx(${i},'reps',this.value)"/></div>
          <div class="dosage-mini"><label>Récup.</label><input class="form-input" value="${escapeHTML(ex.rest||'')}" oninput="updateEx(${i},'rest',this.value)"/></div>
        </div>
        <div class="dosage-row">
          <div class="dosage-mini"><label>Tempo</label><input class="form-input" value="${escapeHTML(ex.tempo||'')}" oninput="updateEx(${i},'tempo',this.value)"/></div>
          <div class="dosage-mini"><label>EVA cible</label><input class="form-input" value="${escapeHTML(ex.evaTarget||'')}" oninput="updateEx(${i},'evaTarget',this.value)"/></div>
          <div class="dosage-mini"><label>Vidéo (URL)</label><input class="form-input" value="${escapeHTML(ex.video||'')}" oninput="updateEx(${i},'video',this.value)"/></div>
        </div>
        <div class="form-grid" style="margin-top:8px">
          <div class="form-group"><label class="form-label">Régression</label><input class="form-input" value="${escapeHTML(ex.regression||'')}" oninput="updateEx(${i},'regression',this.value)"/></div>
          <div class="form-group"><label class="form-label">Progression</label><input class="form-input" value="${escapeHTML(ex.progression||'')}" oninput="updateEx(${i},'progression',this.value)"/></div>
          <div class="form-group full"><label class="form-label">Matériel alternatif</label><input class="form-input" value="${escapeHTML(ex.alt||'')}" oninput="updateEx(${i},'alt',this.value)"/></div>
        </div>
      </div>
    </div>`).join('');
}
function toggleExItem(i){exercisesInBuilder[i]._open=!exercisesInBuilder[i]._open;renderExercisesBuilder()}
function updateEx(i,key,val){exercisesInBuilder[i][key]=val;}

async function saveProgram(){
  const name = document.getElementById('progName').value.trim();
  const patId = document.getElementById('progPatient').value;

  if(!name){
    showToast('Nom requis', 'red');
    return;
  }

  if(!patId){
    showToast('Sélectionnez un patient', 'red');
    return;
  }

  const patientExists = patients.some(p => p.id === patId);

  if(!patientExists){
    showToast('Patient sélectionné invalide', 'red');
    return;
  }

  const btn = document.getElementById('btnSaveProgBtn');
  btn.disabled = true;

  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="loading-spinner" style="border-top-color:#fff"></span> Enregistrement...';

  const selectedPromIds = getSelectedPromIds();

const payload = {
    practitioner_id: currentPractitioner.id,
    is_template: false,
    name,
    phase: document.getElementById('progPhase').value,
    frequency: document.getElementById('progFreq').value,
    description: document.getElementById('progDesc').value,
    patient_id: patId,
    prom_id: selectedPromIds[0] || null,
    exercises: exercisesInBuilder.map(e => {
      const c = { ...e };
      delete c._open;
      return c;
    }),
    updated_at: new Date().toISOString()
  };

// On ajoute prom_ids seulement si la colonne existe (évite l'erreur schema cache)
try {
  payload.prom_ids = selectedPromIds;
} catch(e) {
  console.warn('prom_ids non supporté, on utilise prom_id uniquement');
}

  console.log('[SAVE PROGRAM PAYLOAD]', payload);

  try {
    let saved = null;

    if(editingProgId){
      const { data, error } = await db
        .from('programs')
        .update(payload)
        .eq('id', editingProgId)
        .select()
        .single();

      if(error) throw error;
      saved = data;

    } else {
      const { data, error } = await db
        .from('programs')
        .insert(payload)
        .select()
        .single();

      if(error) throw error;
      saved = data;
    }

    console.log('[PROGRAMME SAUVEGARDÉ]', saved);

    await loadAllData();

    closeModal('modalProgram');
    showToast('Programme assigné au patient', 'green');

    currentPatientId = patId;

    renderPatientPrograms(patId);

  } catch(e) {
    console.error('Erreur saveProgram:', e);
    showToast('Erreur programme : ' + e.message, 'red');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

function renderPatientPrograms(patId){
  const c = document.getElementById('patientProgramContainer');
  const pp = programs.filter(x => x.patient_id === patId);

  if(!pp.length){
    c.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--text3)">
        Aucun programme assigné.
      </div>`;
    return;
  }

  c.innerHTML = pp.map(prog => `
    <div class="prog-card" style="margin-bottom:12px">
      <div class="prog-card-header">
        <div style="display:flex;align-items:flex-start;gap:10px;flex:1">
          <div class="prog-card-icon" style="background:linear-gradient(135deg,#dbeafe,#bfdbfe)">🏋️</div>
          <div style="flex:1">
            <div class="prog-title">${escapeHTML(prog.name)}</div>
            <div class="prog-sub">${escapeHTML(prog.frequency || '')}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm btn-icon-only" onclick="openProgramBuilder('${prog.id}')">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn btn-danger btn-sm btn-icon-only" onclick="deleteProgram('${prog.id}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>

      <div class="prog-card-body">
        ${
          prog.description
            ? `<div style="font-size:12px;color:var(--text2);margin-bottom:8px">${escapeHTML(prog.description)}</div>`
            : ''
        }

        <div style="font-size:12px;color:var(--text3)">
          ${(prog.exercises || []).length} exercice(s)
        </div>

        ${(prog.exercises || []).slice(0,3).map((ex,i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
            <span style="color:var(--accent);font-weight:700">${i + 1}.</span>
            <span>${escapeHTML(ex.name || '')}</span>
            <span style="color:var(--text3);margin-left:auto">
              ${escapeHTML(ex.series || '?')}×${escapeHTML(ex.reps || '?')}
            </span>
          </div>
        `).join('')}
      </div>

      <div class="prog-card-footer">
        <span class="badge badge-blue">${escapeHTML(phaseLabel(prog.phase))}</span>
        <span style="font-size:11px;color:var(--text3)">
          ${new Date(prog.updated_at || prog.created_at).toLocaleDateString('fr-FR')}
        </span>
      </div>
    </div>
  `).join('');
}

function phaseLabel(p){return({crise:'Phase Crise',renfo:'Renforcement',reprise:'Reprise sport',prevention:'Prévention',custom:'Personnalisée'}[p]||p)}

async function deleteProgram(id){
  if(!confirm('Supprimer ce programme ?'))return;
  const {error}=await db.from('programs').delete().eq('id',id);
  if(error){showToast('Erreur','red');return;}
  await loadAllData(); showToast('Supprimé.');
  if(currentPatientId) renderPatientPrograms(currentPatientId);
}

// ===== LIBRARY =====
function renderMusclesPicker(selected = []) {
  selectedMuscles = [...selected];
  renderMusclesGrid(MUSCLES_LIST);
  updateMuscleChips();
}

function renderMusclesGrid(list) {
  const box = document.getElementById('musclesTargetsContainer');
  if (!box) return;

  if (!list.length) {
    box.innerHTML = `<div style="font-size:12px;color:var(--text3);padding:8px">Aucun muscle trouvé.</div>`;
    return;
  }

  box.innerHTML = list.map(m => {
    const isSelected = selectedMuscles.includes(m);
    return `
      <button type="button"
        onclick="toggleMuscle('${m.replace(/'/g, "\\'")}')"
        style="
          padding:5px 11px;
          border-radius:20px;
          border:1.5px solid ${isSelected ? 'var(--accent)' : 'var(--border)'};
          background:${isSelected ? 'var(--accent)' : 'var(--card)'};
          color:${isSelected ? '#fff' : 'var(--text2)'};
          font-size:11px;
          font-weight:600;
          cursor:pointer;
          transition:all .15s;
          white-space:nowrap;
        ">
        ${isSelected ? '✓ ' : ''}${escapeHTML(m)}
      </button>
    `;
  }).join('');
}

function filterMusclesPicker(query) {
  const q = query.toLowerCase().trim();
  const filtered = q
    ? MUSCLES_LIST.filter(m => m.toLowerCase().includes(q))
    : MUSCLES_LIST;
  renderMusclesGrid(filtered);
}

function updateMuscleChips() {
  const chips = document.getElementById('selectedMusclesChips');
  const placeholder = document.getElementById('muscleChipsPlaceholder');
  if (!chips) return;

  // Retire les chips existants (sauf le placeholder)
  Array.from(chips.children).forEach(child => {
    if (child.id !== 'muscleChipsPlaceholder') child.remove();
  });

  if (!selectedMuscles.length) {
    if (placeholder) placeholder.style.display = 'inline';
    return;
  }

  if (placeholder) placeholder.style.display = 'none';

  selectedMuscles.forEach(m => {
    const chip = document.createElement('span');
    chip.style.cssText = `
      display:inline-flex;align-items:center;gap:5px;
      background:var(--accent);color:#fff;
      border-radius:20px;padding:3px 10px;
      font-size:11px;font-weight:700;
    `;
    chip.innerHTML = `
      ${escapeHTML(m)}
      <i class="fa-solid fa-xmark" style="cursor:pointer;font-size:10px"
         onclick="toggleMuscle('${m.replace(/'/g, "\\'")}')"></i>
    `;
    chips.appendChild(chip);
  });
}

function toggleMuscle(name) {
  if (selectedMuscles.includes(name)) {
    selectedMuscles = selectedMuscles.filter(m => m !== name);
  } else {
    selectedMuscles.push(name);
  }
  // Maintient le filtre de recherche actif
  const searchInput = document.getElementById('muscleSearchInput');
  const q = searchInput ? searchInput.value : '';
  filterMusclesPicker(q);
  updateMuscleChips();
}

function openNewExercise(exData = null, idx = null) {
  try {
    editingExId = idx;
    const ex = exData || {};

    const titleEl = document.getElementById('modalExTitle');
    if (titleEl) titleEl.textContent = exData ? 'Modifier exercice' : 'Nouvel exercice';

    // Vide tous les champs
    const fields = ['exName','exFocus','exSeries','exReps','exRest','exTempo','exEVA','exVideo','exRegress','exProgress','exAlt'];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if(el) el.value = '';
    });

    // Remplit avec les données existantes (si modification)
    const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };
    setVal('exName', ex.name);
    setVal('exFocus', ex.focus);
    setVal('exSeries', ex.series);
    setVal('exReps', ex.reps);
    setVal('exRest', ex.rest);
    setVal('exTempo', ex.tempo);
    setVal('exEVA', ex.eva_target);
    setVal('exRegion', ex.region || 'Autre');
    setVal('exVideo', ex.video);
    setVal('exRegress', ex.regression);
    setVal('exProgress', ex.progression);
    setVal('exAlt', ex.alt_material);

    renderMusclesPicker(ex.muscles_targets || []);
    openModal('modalExercise');
  } catch (error) {
    alert("Erreur d'ouverture Exercice : " + error.message);
  }
}

async function saveExercise() {
  try {
    const nameInput = document.getElementById('exName');
    const name = nameInput ? nameInput.value.trim() : '';

    if (!name) {
      showToast('Le nom de l\'exercice est requis', 'red');
      return;
    }

    // On récupère le bouton pour le désactiver pendant le chargement
    const btn = document.querySelector('#modalExercise .btn-primary');
    const oldHtml = btn ? btn.innerHTML : '<i class="fa-solid fa-floppy-disk"></i> Sauvegarder';

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner" style="border-top-color:#fff"></span> Sauvegarde...';
    }

    // Création de l'objet avec sécurisation de tous les champs (évite les crashs si un champ manque)
    const payload = {
      practitioner_id: currentPractitioner.id,
      name: name,
      focus: document.getElementById('exFocus')?.value.trim() || '',
      series: document.getElementById('exSeries')?.value.trim() || '',
      reps: document.getElementById('exReps')?.value.trim() || '',
      rest: document.getElementById('exRest')?.value.trim() || '',
      tempo: document.getElementById('exTempo')?.value.trim() || '',
      eva_target: document.getElementById('exEVA')?.value.trim() || '',
      category: 'autre',
      region: document.getElementById('exRegion')?.value || 'Autre',
      muscles_targets: selectedMuscles || [],
      video: document.getElementById('exVideo')?.value.trim() || '',
      regression: document.getElementById('exRegress')?.value.trim() || '',
      progression: document.getElementById('exProgress')?.value.trim() || '',
      alt_material: document.getElementById('exAlt')?.value.trim() || '',
      updated_at: new Date().toISOString()
    };

    if (editingExId !== null && library[editingExId]) {
      // MODE MODIFICATION
      const { error } = await db
        .from('exercises_library')
        .update(payload)
        .eq('id', library[editingExId].id)
        .eq('practitioner_id', currentPractitioner.id);

      if (error) throw error;
      showToast('Exercice modifié avec succès !', 'green');
    } else {
      // MODE AJOUT
      const { error } = await db
        .from('exercises_library')
        .insert(payload);

      if (error) throw error;
      showToast('Nouvel exercice ajouté !', 'green');
    }

    // Réinitialisation et fermeture
    editingExId = null;
    await loadAllData();
    closeModal('modalExercise');

    // Réactivation du bouton
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }

  } catch (e) {
    console.error('Erreur détaillée saveExercise:', e);
    showToast('Erreur : ' + (e.message || 'Impossible de sauvegarder'), 'red');
    
    // En cas d'erreur, on réactive le bouton pour ne pas bloquer l'utilisateur
    const btn = document.querySelector('#modalExercise .btn-primary');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Sauvegarder';
    }
  }
}

function renderLibrary(){
  const g = document.getElementById('libraryGrid');
  if (!g) {
    console.warn('[renderLibrary] #libraryGrid introuvable');
    return;
  }

  const statExos = document.getElementById('statExos');
  if (statExos) {
    statExos.textContent = library.length;
  }

  const filterEl = document.getElementById('regionFilter');
  const filter = filterEl ? filterEl.value : 'all';

  const muscleFilterEl = document.getElementById('muscleFilter');
  const muscleFilter = muscleFilterEl ? muscleFilterEl.value : 'all';

  if (muscleFilterEl) {
    const currentVal = muscleFilterEl.value;

    const allMuscles = [...new Set(
      library.flatMap(ex =>
        Array.isArray(ex.muscles_targets) ? ex.muscles_targets : []
      )
    )].filter(Boolean).sort();

    muscleFilterEl.innerHTML =
      '<option value="all">Tous les muscles</option>' +
      allMuscles.map(m =>
        `<option value="${escapeHTML(m)}" ${m === currentVal ? 'selected' : ''}>${escapeHTML(m)}</option>`
      ).join('');
  }

  const filtered = library.filter(ex => {
    const regionOk = filter === 'all' || ex.region === filter;
    const muscleOk = muscleFilter === 'all' ||
      (Array.isArray(ex.muscles_targets) && ex.muscles_targets.includes(muscleFilter));

    return regionOk && muscleOk;
  });

  const catLabels = {
    quadri: 'Quadriceps',
    fessiers: 'Fessiers',
    ischio: 'Ischio',
    gainage: 'Gainage',
    cardio: 'Cardio',
    iso: 'Isométrique',
    autre: 'Autre'
  };

  if(!filtered.length){
    g.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--text3);grid-column:1/-1">
        Aucun exercice trouvé dans cette région.
      </div>`;
    return;
  }

  g.innerHTML = filtered.map(ex => {
    const originalIndex = library.findIndex(item => item.id === ex.id);

    return `
      <div class="lib-card">
        <div class="lib-card-name">${escapeHTML(ex.name)}</div>

        ${ex.is_public ? '<span class="badge badge-green" style="font-size:9px">🌐 Partagé</span>' : ''}

        <div class="lib-card-meta">
          ${Array.isArray(ex.muscles_targets) && ex.muscles_targets.length
            ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">
                ${ex.muscles_targets.map(m => `
                  <span class="badge badge-blue" style="font-size:9px">${escapeHTML(m)}</span>
                `).join('')}
              </div>`
            : ''}

          <span class="badge badge-blue">${escapeHTML(ex.region || 'Autre')}</span>
          <span class="badge badge-gray">${escapeHTML(catLabels[ex.category] || ex.category || 'Autre')}</span>
        </div>

        ${ex.focus ? `
          <div style="font-size:12px;color:var(--text2);margin-top:8px;line-height:1.4">
            ${escapeHTML(ex.focus)}
          </div>
        ` : ''}

        <div style="font-size:11px;color:var(--text3);margin-top:8px">
          ${escapeHTML(ex.series || '?')} × ${escapeHTML(ex.reps || '?')}
          ${ex.rest ? ` · récup. ${escapeHTML(ex.rest)}` : ''}
        </div>

        <div style="display:flex;gap:6px;margin-top:12px">
          <button class="btn btn-secondary btn-sm" onclick="openNewExercise(library[${originalIndex}], ${originalIndex})">
            <i class="fa-solid fa-pen"></i>
            Modifier
          </button>

          <button class="btn btn-danger btn-sm" onclick="deleteExercise(${originalIndex})">
            <i class="fa-solid fa-trash"></i>
            Supprimer
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteExercise(i){
  if(!confirm('Supprimer cet exercice ?'))return;
  const {error}=await db.from('exercises_library').delete().eq('id',library[i].id);
  if(error){showToast('Erreur','red');return;}
  await loadAllData(); showToast('Supprimé.');
}
function addFromLibrary(){
  // Réinitialise les filtres à l'ouverture
  const regionEl = document.getElementById('libPickerRegion');
  const muscleEl = document.getElementById('libPickerMuscle');
  const searchEl = document.getElementById('libPickerSearch');

  if(regionEl) regionEl.value = 'all';
  if(searchEl) searchEl.value = '';

  // Peuple le sélecteur de muscles avec ceux présents en bibliothèque
  if(muscleEl){
    const allMuscles = [...new Set(
      library.flatMap(ex =>
        Array.isArray(ex.muscles_targets) ? ex.muscles_targets : []
      )
    )].filter(Boolean).sort();

    muscleEl.innerHTML =
      '<option value="all">Tous les muscles</option>' +
      allMuscles.map(m =>
        `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`
      ).join('');
  }

  renderLibPicker();
  openModal('modalLibPicker');
}

function renderLibPicker(){
  const g = document.getElementById('libPickerGrid');
  const countEl = document.getElementById('libPickerCount');

  const q       = (document.getElementById('libPickerSearch')?.value  || '').toLowerCase().trim();
  const region  =  document.getElementById('libPickerRegion')?.value  || 'all';
  const muscle  =  document.getElementById('libPickerMuscle')?.value  || 'all';

  const filtered = library.filter(ex => {
    // Filtre texte
    const textOk = !q || (ex.name || '').toLowerCase().includes(q);

    // Filtre région
    const regionOk = region === 'all' || ex.region === region;

    // Filtre muscle
    const muscleOk = muscle === 'all' ||
      (Array.isArray(ex.muscles_targets) && ex.muscles_targets.includes(muscle));

    return textOk && regionOk && muscleOk;
  });

  // Compteur
  if(countEl){
    countEl.textContent = filtered.length
      ? `${filtered.length} exercice(s) trouvé(s)`
      : '';
  }

  if(!filtered.length){
    g.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--text3);
                  grid-column:1/-1;font-size:13px">
        <i class="fa-solid fa-magnifying-glass"
           style="font-size:24px;margin-bottom:8px;display:block;opacity:.3"></i>
        Aucun exercice trouvé.<br>
        <span style="font-size:11px">Modifiez vos filtres ou ajoutez des exercices à la bibliothèque.</span>
      </div>`;
    return;
  }

  g.innerHTML = filtered.map(ex => {
    // Encode proprement pour l'onclick
    const exJson = JSON.stringify(ex).replace(/'/g, "&#39;").replace(/"/g, '&quot;');

    const musclesHtml = Array.isArray(ex.muscles_targets) && ex.muscles_targets.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:5px">
          ${ex.muscles_targets.slice(0,3).map(m =>
            `<span class="badge badge-blue" style="font-size:9px">${escapeHTML(m)}</span>`
          ).join('')}
          ${ex.muscles_targets.length > 3
            ? `<span class="badge badge-gray" style="font-size:9px">+${ex.muscles_targets.length - 3}</span>`
            : ''}
        </div>`
      : '';

    return `
      <div class="lib-card" onclick='addExFromLib(JSON.parse(this.dataset.ex))'
           data-ex='${JSON.stringify(ex).replace(/'/g, "&#39;")}'>
        <div class="lib-card-name">${escapeHTML(ex.name)}</div>

        <div class="lib-card-meta" style="margin-top:4px">
          ${ex.region
            ? `<span class="badge badge-blue" style="font-size:9px">${escapeHTML(ex.region)}</span>`
            : ''}
        </div>

        ${musclesHtml}

        <div style="font-size:11px;color:var(--text3);margin-top:5px">
          ${escapeHTML(ex.series || '?')} × ${escapeHTML(ex.reps || '?')}
          ${ex.rest ? ` · ${escapeHTML(ex.rest)}` : ''}
        </div>

        ${ex.focus ? `
          <div style="font-size:11px;color:var(--text2);margin-top:4px;
                      line-height:1.3;overflow:hidden;
                      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">
            ${escapeHTML(ex.focus)}
          </div>
        ` : ''}

        <div style="font-size:11px;color:var(--accent);margin-top:8px;
                    font-weight:700;display:flex;align-items:center;gap:4px">
          <i class="fa-solid fa-plus"></i> Ajouter au programme
        </div>
      </div>
    `;
  }).join('');
}

function filterLibPicker(){ renderLibPicker(); }

function addExFromLib(ex){
  if (ex.alt_material && ex.alt_material.startsWith('[')) {
    try {
      const savedExercises = JSON.parse(ex.alt_material);
      exercisesInBuilder = savedExercises;
      renderExercisesBuilder();
      showToast('Modèle chargé !', 'green');
    } catch(e) {
      showToast('Erreur lecture modèle', 'red');
    }
  } else {
    exercisesInBuilder.push({
      id: 'tmp' + Date.now(),
      name: ex.name || 'Exercice',
      series: ex.series || '',
      reps: ex.reps || '',
      rest: ex.rest || '',
      tempo: ex.tempo || '',
      focus: ex.focus || '',
      video: ex.video || '',
      regression: ex.regression || '',
      progression: ex.progression || '',
      alt: ex.alt_material || '',
      evaTarget: ex.eva_target || ''
    });
    renderExercisesBuilder();
    showToast(ex.name + ' ajouté !', 'green');
  }
  closeModal('modalLibPicker');
}

// ===== MESSAGES =====
async function renderMessages(patId){
  const {data} = await db.from('messages').select('*').eq('patient_id',patId).order('created_at',{ascending:true});
  messages = data||[];
  const c=document.getElementById('messagesContainer');
  if(!messages.length){c.innerHTML=`<div style="text-align:center;padding:16px;color:var(--text3);font-size:13px">Aucun message échangé.</div>`;return;}
  c.innerHTML = messages.map(m => {
  const isKine = m.sender === 'kine'; // On ne met pas m.sender directement dans le HTML
  const align = isKine ? 'flex-end' : 'flex-start';
  const bg = isKine ? 'var(--accent)' : 'var(--bg)';
  const color = isKine ? '#fff' : 'var(--text)';
  const radius = isKine ? '14px 14px 4px 14px' : '14px 14px 14px 4px';
  return `
    <div style="display:flex;flex-direction:column;align-items:${align}">
      <div style="max-width:75%;background:${bg};color:${color};border-radius:${radius};padding:10px 14px;font-size:13px;border:1px solid var(--border)">
        ${escapeHTML(m.text)}
      </div>
      <div style="font-size:10px;color:var(--text3);margin-top:3px">
        ${new Date(m.created_at).toLocaleString('fr-FR')}
      </div>
    </div>`;
}).join('');
  c.scrollTop=c.scrollHeight;
}
async function sendMessage(){
  const input = document.getElementById('newMessage');
  const text = input.value.trim();

  if(!text || !currentPatientId) return;

  input.disabled = true;

  try {
    const { error } = await db
      .from('messages')
      .insert({
        patient_id: currentPatientId,
        sender: 'kine',
        text,
        read: false
      });

    if(error) throw error;

    input.value = '';
    await renderMessages(currentPatientId);

  } catch(e) {
    console.error('Erreur sendMessage:', e);
    showToast('Erreur envoi', 'red');
  } finally {
    input.disabled = false;
    input.focus();
  }
}

// ===== SUIVI =====
async function renderSuivi(patId){
  const {data} = await db.from('sessions').select('*').eq('patient_id',patId).order('created_at',{ascending:false});
  const sessions=data||[];
  
  document.getElementById('nbSessions').textContent=sessions.length;
  
  if(sessions.length){
    document.getElementById('avgEVA').parentElement.parentElement.style.display = 'none'; // Cache la card EVA
    document.getElementById('avgBorg').textContent=(sessions.reduce((a,s)=>a+(s.borg||0),0)/sessions.length).toFixed(1)+'/20';    
    document.getElementById('sessionHistoryBody').innerHTML = sessions.map(s => {
      
      // --- NOUVEAU : Traitement des données du Body Chart ---
      let bodyChartHTML = '';
      if (s.body_chart && Object.keys(s.body_chart).length > 0) {
        // On boucle sur chaque zone touchée (ex: epaule-d, genou-g...)
        bodyChartHTML = Object.values(s.body_chart).map(zone => {
          const symps = zone.symptoms.map(sym => 
            `• ${escapeHTML(sym.label)} <span style="color:var(--accent);font-weight:700">(${sym.eva}/10)</span>`
          ).join('<br>');
          
          return `<div style="margin-bottom:8px; background:var(--bg); padding:6px 8px; border-radius:6px; border:1px solid var(--border);">
                    <span style="font-weight:800;color:var(--text2);font-size:11px;text-transform:uppercase;">
                      <i class="fa-solid fa-location-crosshairs"></i> ${escapeHTML(zone.name)}
                    </span><br>
                    <span style="font-size:11px">${symps}</span>
                  </div>`;
        }).join('');
      } else {
        // Rétrocompatibilité avec les anciennes séances (avant le Body Chart)
        let symptomsArray = [];
        try {
          symptomsArray = typeof s.symptoms === 'string' ? JSON.parse(s.symptoms || '[]') : (s.symptoms || []);
        } catch(e) { symptomsArray = []; }
        bodyChartHTML = symptomsArray.length ? symptomsArray.map(sym => escapeHTML(sym)).join(', ') : '<span style="color:var(--text3)">Rien à signaler</span>';
      }

      const evaVal = s.eva ?? '—';
      const borgVal = s.borg ?? '—';
      const evaClass = s.eva >= 7 ? 'badge-green' : s.eva >= 4 ? 'badge-orange' : 'badge-red';

      return `
        <tr>
          <td style="vertical-align:top; padding-top:16px;">${new Date(s.created_at).toLocaleDateString('fr-FR')}</td>
          <td style="vertical-align:top; padding-top:16px;"><span class="badge ${evaClass}">${escapeHTML(String(evaVal))}/10</span></td>
          <td style="vertical-align:top; padding-top:16px;"><span class="badge badge-blue">${escapeHTML(String(borgVal))}/20</span></td>
          <td style="font-size:11px; vertical-align:top;">${bodyChartHTML}</td>
          <td style="font-size:12px; font-style:italic; vertical-align:top; padding-top:16px; color:var(--text2)">${escapeHTML(s.note || '—')}</td>
        </tr>`;
    }).join('');
  } else {
    document.getElementById('avgEVA').textContent='—';
    document.getElementById('avgBorg').textContent='—';
    document.getElementById('sessionHistoryBody').innerHTML=`<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text3)">Aucune séance enregistrée</td></tr>`;
  }
}

async function openAssessmentForCurrentPatient(){
  const p = patients.find(x => x.id === currentPatientId);

  if(!p){
    showToast('Patient introuvable', 'red');
    return;
  }

  const pathologyName = String(p.pathology || '').trim();

  if(!pathologyName){
    showToast('Ce patient n’a pas de pathologie renseignée', 'red');
    return;
  }

  let pathology = pathosList.find(x =>
    String(x.name || '').trim().toLowerCase() === pathologyName.toLowerCase()
  );

  if(!pathology){
    const { data, error } = await db
      .from('pathologies_library')
      .insert({
        practitioner_id: currentPractitioner.id,
        name: pathologyName,
        education_tip: ''
      })
      .select()
      .single();

    if(error){
      showToast('Erreur création pathologie : ' + error.message, 'red');
      return;
    }

    pathology = data;
    pathosList.unshift(data);
    renderPathos();
  }

  await openAssessmentModal(pathology.id, pathology.name);

  const sel = document.getElementById('assessmentPatient');
  if(sel){
    sel.value = currentPatientId;
    await loadAssessmentHistory();
  }

  switchAssessmentTab(1, document.querySelectorAll('#modalAssessment .tab')[1]);
}

async function renderPatientAssessments(patientId){
  const box = document.getElementById('patientAssessmentsContainer');

  if(!box){
    console.warn('[BILANS] patientAssessmentsContainer introuvable');
    return;
  }

  if(!patientId){
    box.innerHTML = `
      <div style="text-align:center;padding:24px;color:var(--text3)">
        Aucun patient sélectionné.
      </div>
    `;
    return;
  }

  box.innerHTML = `
    <div class="full-loader">
      <span class="loading-spinner" style="border-top-color:var(--accent);border-color:var(--border)"></span>
      Chargement des bilans...
    </div>
  `;

  try {
    console.log('[LOAD BILANS PATIENT]', patientId);

    let query = db
      .from('pathology_assessment_entries')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending:false });

    // On n'ajoute le filtre practitioner que si disponible
    if(currentPractitioner?.id){
      query = query.eq('practitioner_id', currentPractitioner.id);
    }

    const { data, error } = await query;

    if(error) throw error;

    console.log('[BILANS TROUVÉS]', data);

    if(!data || !data.length){
      box.innerHTML = `
        <div style="text-align:center;padding:24px;color:var(--text3)">
          Aucun bilan enregistré pour ce patient.
        </div>
      `;
      return;
    }

    box.innerHTML = data.map(entry => {
      const template = entry.template_snapshot || {};
      const sections = Array.isArray(template.sections) ? template.sections : [];
      const values = entry.values || {};

      const sectionsHtml = sections.map(section => {
        const fields = Array.isArray(section.fields) ? section.fields : [];

        const fieldsHtml = fields.map(field => {
          const val = values[field.id];

          if(val === undefined || val === null || val === '') return '';

          return `
            <div class="info-row">
              <span class="info-row-label">${escapeHTML(field.label || 'Champ')}</span>
              <span class="info-row-val">${escapeHTML(val)}</span>
            </div>
          `;
        }).join('');

        if(!fieldsHtml.trim()) return '';

        return `
          <div style="margin-top:12px">
            <div class="info-card-title" style="margin-bottom:6px">
              <i class="fa-solid ${escapeHTML(section.icon || 'fa-folder')}"></i>
              ${escapeHTML(section.title || 'Section')}
            </div>
            ${fieldsHtml}
          </div>
        `;
      }).join('');

      return `
        <div class="info-card" style="margin-bottom:14px">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
            <div>
              <div style="font-size:15px;font-weight:800;color:var(--text)">
                ${escapeHTML(entry.title || 'Bilan')}
              </div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">
                ${
                  entry.assessment_date
                    ? new Date(entry.assessment_date).toLocaleDateString('fr-FR')
                    : entry.created_at
                      ? new Date(entry.created_at).toLocaleDateString('fr-FR')
                      : '—'
                }
              </div>
            </div>

            <span class="badge badge-blue">Bilan</span>
          </div>

          ${sectionsHtml || `
            <div style="font-size:12px;color:var(--text3);margin-top:12px">
              Bilan enregistré, mais aucun champ renseigné.
            </div>
          `}

          ${entry.notes ? `
            <div style="margin-top:12px;padding:10px;border-radius:10px;background:var(--bg);border:1px solid var(--border)">
              <div class="info-card-title" style="margin-bottom:6px">
                <i class="fa-solid fa-lock"></i>
                Notes privées
              </div>
              <div style="font-size:12px;color:var(--text2);line-height:1.5">
                ${escapeHTML(entry.notes)}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

  } catch(e) {
    console.error('Erreur chargement bilans patient:', e);

    box.innerHTML = `
      <div class="alert alert-red">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <div>
          Erreur chargement bilans :
          ${escapeHTML(e.message)}
        </div>
      </div>
    `;
  }
}
async function renderPromResponses(patientId){
  const box = document.getElementById('promResponsesContainer');
  if(!box) return;

  box.innerHTML = `
    <div class="full-loader">
      <span class="loading-spinner" style="border-top-color:var(--accent);border-color:var(--border)"></span>
      Chargement des questionnaires...
    </div>`;

  try {
    // 1) On récupère les réponses du patient
    const { data: responses, error } = await db
      .from('prom_responses')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });

    if(error) throw error;

    if(!responses || !responses.length){
      box.innerHTML = `
        <div style="text-align:center;padding:24px;color:var(--text3)">
          Aucune réponse de questionnaire.
        </div>`;
      return;
    }

    // 2) On charge les modèles (titres + intitulés des questions)
    const templateIds = [...new Set(responses.map(r => r.template_id).filter(Boolean))];

    let templatesById = {};
    if(templateIds.length){
      const { data: templates } = await db
        .from('prom_templates')
        .select('*')
        .in('id', templateIds);

      (templates || []).forEach(t => {
        let questions = [];
        try {
          questions = typeof t.questions === 'string'
            ? JSON.parse(t.questions || '[]')
            : (t.questions || []);
        } catch(e) { questions = []; }
        templatesById[t.id] = { title: t.title || 'Questionnaire', questions };
      });
    }

    // 3) On affiche chaque réponse
    box.innerHTML = responses.map(resp => {
      const template = templatesById[resp.template_id] || { title: 'Questionnaire', questions: [] };

      let answers = [];
      try {
        answers = typeof resp.responses === 'string'
          ? JSON.parse(resp.responses || '[]')
          : (resp.responses || []);
      } catch(e) { answers = []; }

      const answersHtml = answers.map(a => {
        const q = template.questions[a.question_index];
        const label = q ? (q.question || `Question ${a.question_index + 1}`) : `Question ${a.question_index + 1}`;
        const value = (a.value === '' || a.value === null || a.value === undefined)
          ? '<span style="color:var(--text3)">— non renseigné</span>'
          : escapeHTML(String(a.value));
        return `
          <div class="info-row">
            <span class="info-row-label">${escapeHTML(label)}</span>
            <span class="info-row-val">${value}</span>
          </div>`;
      }).join('');

      return `
        <div class="info-card" style="margin-bottom:14px">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px">
            <div style="font-size:15px;font-weight:800;color:var(--text)">
              ${escapeHTML(template.title)}
            </div>
            <span class="badge badge-blue">
              ${new Date(resp.created_at).toLocaleDateString('fr-FR')}
            </span>
          </div>
          ${answersHtml || '<div style="font-size:12px;color:var(--text3)">Aucune réponse.</div>'}
        </div>`;
    }).join('');

  } catch(e) {
    console.error('Erreur renderPromResponses:', e);
    box.innerHTML = `
      <div class="alert alert-red">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <div>Erreur chargement questionnaires : ${escapeHTML(e.message)}</div>
      </div>`;
  }
}

function switchTab(n,el){
  [0,1,2,3].forEach(i => {
    const tab = document.getElementById('tabContent' + i);
    if(tab) tab.style.display = i === n ? 'block' : 'none';
  });

  const tabsWrapper = el?.closest('.tabs');

  if(tabsWrapper){
    tabsWrapper.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  } else {
    document.querySelectorAll('#view-patient-detail .tabs .tab').forEach(t => t.classList.remove('active'));
  }

  if(el) el.classList.add('active');

    if(n === 1 && currentPatientId){ renderSuivi(currentPatientId); renderPromResponses(currentPatientId); }
  if(n === 2 && currentPatientId) renderMessages(currentPatientId);
  if(n === 3 && currentPatientId) renderPatientAssessments(currentPatientId);
}

// ===== DASHBOARD =====
async function refreshDashboard(){
  // --- Statistiques simples (pas de requête, données déjà en mémoire) ---
  document.getElementById('statPatients').textContent =
    patients.filter(p => p.status === 'active').length;

  document.getElementById('statProgs').textContent =
    programs.length;

  document.getElementById('statInactive').textContent =
    patients.filter(p => p.status === 'pause').length;

  // --- Récupération des dernières séances en UNE SEULE requête ---
  const activePatients = patients.filter(x => x.status === 'active');

  // Si aucun patient actif, on affiche juste un message positif et on arrête
  if (!activePatients.length) {
    document.getElementById('alertsContainer').innerHTML =
      `<div class="alert alert-warn">
         <i class="fa-solid fa-circle-check"></i>
         <div>Aucun patient actif pour le moment.</div>
       </div>`;
    return;
  }

  const activeIds = activePatients.map(p => p.id);

  try {
    // ✅ UNE seule requête pour tous les patients
    const { data: lastSessions, error } = await db
      .from('sessions')
      .select('patient_id, created_at')
      .in('patient_id', activeIds)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // On construit un dictionnaire { patient_id: date_dernière_séance }
    // On ne garde que la première occurrence de chaque patient
    // (la plus récente, puisqu'on a trié par date décroissante)
    const lastSessionByPatient = {};
    (lastSessions || []).forEach(s => {
      if (!lastSessionByPatient[s.patient_id]) {
        lastSessionByPatient[s.patient_id] = s.created_at;
      }
    });

    // On calcule les alertes pour chaque patient actif
    const flagAlerts = activePatients
  .filter(p =>
    !p.flag_alert_read &&
    (p.last_flag_status === 'red' || p.last_flag_status === 'yellow')
  )
  .map(p => ({
    patient: p,
    type: p.last_flag_status,
    label: p.last_flag_status === 'red'
      ? 'Red flag signalé au questionnaire d’entrée'
      : 'Yellow flag signalé au questionnaire d’entrée'
  }));

const now = Date.now();
const alerts = [];

activePatients.forEach(p => {
  const lastDate = lastSessionByPatient[p.id];

  if (!lastDate) {
    alerts.push({
      patient: p,
      type: 'yellow',
      days: null,
      label: 'aucune séance jamais enregistrée'
    });
  } else {
    const days = Math.floor((now - new Date(lastDate).getTime()) / 86400000);

    if (days > 5) {
      alerts.push({
        patient: p,
        type: 'yellow',
        days,
        label: `${days} jour${days > 1 ? 's' : ''} sans séance`
      });
    }
  }
});

const allAlerts = [...flagAlerts, ...alerts];


    // Affichage des alertes
    
    const ac = document.getElementById('alertsContainer');

    if (!allAlerts.length) {
      ac.innerHTML =
        `<div class="alert alert-warn">
           <i class="fa-solid fa-circle-check"></i>
           <div>Aucune alerte active. Tout va bien ! 🎉</div>
         </div>`;
    } else {
      ac.innerHTML = allAlerts.map(a => `
  <div class="alert ${a.type === 'red' ? 'alert-red' : 'alert-warn'}">
    <i class="fa-solid ${a.type === 'red' ? 'fa-triangle-exclamation' : 'fa-circle-exclamation'}"></i>
    <div>
      <strong>
        ${escapeHTML(a.patient.first_name)} ${escapeHTML(a.patient.last_name)}
      </strong>
      — ${escapeHTML(a.label)}
    </div>
  </div>`).join('');
    }

  } catch(e) {
    console.error('refreshDashboard error:', e);
    showToast('Erreur lors du chargement du tableau de bord', 'red');
  }
}


// ===== SETTINGS =====
async function saveSettings(){
  const payload={first_name:document.getElementById('settFirstName').value,last_name:document.getElementById('settLastName').value,speciality:document.getElementById('settSpeciality').value,cabinet:document.getElementById('settCabinet').value};
  const {error}=await db.from('practitioners').update(payload).eq('id',currentPractitioner.id);
  if(error){showToast('Erreur','red');return;}
  currentPractitioner={...currentPractitioner,...payload};
  document.getElementById('sidebarName').textContent=payload.first_name||currentPractitioner.email;
  showToast('Sauvegardé !');
}

// ===== VIEWS / UTILS =====
function goToDashboard(){
  window.location.href = new URL('dashboard.html', window.location.href).href;
}

function showBackoffice(){
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';

  document.getElementById('sidebarName').textContent =
    currentPractitioner.first_name ||
    currentPractitioner.email ||
    'Kinésithérapeute';

  document.getElementById('sidebarInitials').textContent =
    (
      currentPractitioner.first_name?.[0] ||
      currentPractitioner.email?.[0] ||
      'K'
    ).toUpperCase();

  document.getElementById('settFirstName').value =
    currentPractitioner.first_name || '';

  document.getElementById('settLastName').value =
    currentPractitioner.last_name || '';

  document.getElementById('settSpeciality').value =
    currentPractitioner.speciality || '';

  document.getElementById('settCabinet').value =
    currentPractitioner.cabinet || '';

  // Ne pas bloquer l'ouverture du backoffice si les notifications échouent
  initNotifications().catch(e => {
    console.warn('[Notif] Initialisation ignorée :', e);
  });
  initMobileUI();

}

function showLogin(){
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appScreen').style.display = 'none';
}

function toggleTheme(){
  const d=document.documentElement;const dark=d.getAttribute('data-theme')==='dark';
  d.setAttribute('data-theme',dark?'light':'dark');
  document.getElementById('themeBtn').innerHTML=dark?'<i class="fa-solid fa-moon"></i>':'<i class="fa-solid fa-sun"></i>';
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('open');
    // Sécurité : On force l'affichage directement en JS
    modal.style.setProperty('display', 'flex', 'important');
    modal.style.setProperty('pointer-events', 'auto', 'important');
    modal.style.setProperty('z-index', '9999', 'important');
  } else {
    alert("Erreur: Impossible de trouver la fenêtre : " + id);
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('open');
    modal.style.setProperty('display', 'none', 'important');
    modal.style.setProperty('pointer-events', 'none', 'important');
  }
}

// Fermer quand on clique à côté
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => {
    if(e.target === o) closeModal(o.id);
  });
});

// Fermer avec la touche Echap
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(o => closeModal(o.id));
  }
});

function escapeHTML(value){
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ===== YOUTUBE UTILS =====
function getYouTubeVideoId(url) {
  if (!url) return null;
  const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
  const match = String(url).match(regex);
  return match ? match[1] : null;
}

function renderYouTubeEmbed(url) {
  const videoId = getYouTubeVideoId(url);

  if (!videoId) {
    return url
      ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer"
            style="color:var(--accent);font-size:12px;display:inline-flex;align-items:center;gap:6px">
            <i class="fa-brands fa-youtube" style="color:#ef4444"></i> Voir la vidéo
         </a>`
      : '';
  }

  // ✅ youtube-nocookie + referrerpolicy = fix erreur 153
  return `
    <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;
                border-radius:10px;background:#000;margin-top:8px">
      <iframe
        src="https://www.youtube-nocookie.com/embed/${escapeHTML(videoId)}?rel=0&modestbranding=1"
        style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"
        referrerpolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
        loading="lazy"
        title="Vidéo d'exercice">
      </iframe>
    </div>`;
}

function showToast(msg, type = 'green') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const icons = {
    green: 'fa-circle-check',
    red:   'fa-circle-xmark',
    blue:  'fa-circle-info'
  };
  const colors = {
    green: '#34d399',
    red:   '#f87171',
    blue:  '#60a5fa'
  };

  const t = document.createElement('div');
  t.className = 'toast';

  // ✅ On crée l'icône séparément
  const icon = document.createElement('i');
  icon.className = `fa-solid ${icons[type] || icons.green}`;
  icon.style.color = colors[type] || colors.green;

  // ✅ On crée le texte séparément — textContent ne peut pas contenir de HTML
  const text = document.createElement('span');
  text.textContent = msg; // ← textContent = jamais de XSS possible

  t.appendChild(icon);
  t.appendChild(text);
  document.body.appendChild(t);

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}

// ============================================================
// SYSTÈME DE NOTIFICATIONS
// ============================================================

// Clé publique VAPID — remplacez par votre vraie clé générée à l'étape 4
const VAPID_PUBLIC_KEY = 'BIa3yXKkjyMj_yhnTPPh4lYscuUNlCcD7uC3ytXy1jgc8JuoM2ktUkSlleFgIyZaoYeg0KgBZksJ3kGv2qBqPP4';

// ===== ENREGISTREMENT DU SERVICE WORKER =====

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.log('[Notif] Service Workers non supportés');
    return null;
  }

  const isHttp =
    window.location.protocol === 'http:' ||
    window.location.protocol === 'https:';

  if (!isHttp) {
    console.warn('[Notif] Service Worker ignoré : l’app n’est pas servie en HTTP/HTTPS');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    console.log('[Notif] Service Worker enregistré:', registration.scope);
    return registration;
  } catch(e) {
    console.error('[Notif] Erreur enregistrement SW:', e);
    return null;
  }
}

// ===== DEMANDE D'AUTORISATION PUSH =====
async function requestPushPermission() {
  // Vérifie le support
  if (!('Notification' in window)) {
    showToast('Votre navigateur ne supporte pas les notifications', 'red');
    return false;
  }

  // Si déjà autorisé, pas besoin de redemander
  if (Notification.permission === 'granted') {
    return true;
  }

  // Si l'utilisateur a déjà refusé, on ne peut plus demander
  if (Notification.permission === 'denied') {
    showToast(
      'Notifications bloquées — autorisez-les dans les réglages du navigateur',
      'red'
    );
    return false;
  }

  // On demande l'autorisation
  const permission = await Notification.requestPermission();

  if (permission === 'granted') {
    showToast('Notifications activées !', 'green');
    return true;
  } else {
    showToast('Notifications refusées', 'red');
    return false;
  }
}

// ===== ABONNEMENT PUSH =====
// Convertit la clé VAPID du format base64 au format binaire
// (nécessaire pour l'API Push du navigateur)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeToPush() {
  try {
    // Récupère le Service Worker enregistré
    const registration = await navigator.serviceWorker.ready;

    // Vérifie si un abonnement existe déjà
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Crée un nouvel abonnement avec notre clé VAPID
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, // obligatoire : toute notif doit être visible
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
      console.log('[Notif] Nouvel abonnement push créé');
    } else {
      console.log('[Notif] Abonnement push déjà existant');
    }

    // Sauvegarde l'abonnement dans Supabase
    await savePushSubscription(subscription);
    return subscription;

  } catch(e) {
    console.error('[Notif] Erreur abonnement push:', e);
    return null;
  }
}

async function savePushSubscription(subscription) {
  // Extrait les données de l'abonnement
  const subJson = subscription.toJSON();

  const { error } = await db
    .from('push_subscriptions')
    .upsert({
      user_id:  currentPractitioner.id,
      user_type: 'kine',
      endpoint: subJson.endpoint,
      p256dh:   subJson.keys.p256dh,
      auth:     subJson.keys.auth,
      last_used_at: new Date().toISOString()
    }, {
      onConflict: 'endpoint' // Si l'endpoint existe déjà, on met à jour
    });

  if (error) {
    console.error('[Notif] Erreur sauvegarde abonnement:', error);
  } else {
    console.log('[Notif] Abonnement sauvegardé dans Supabase');
  }
}

// ===== INITIALISATION COMPLÈTE DES NOTIFICATIONS =====
async function initNotifications() {
  if (!currentPractitioner) return;

  // 1. Charge les notifications in-app, même sans permission push
  await loadNotifications();

  // 2. Écoute les notifications en realtime
  setupNotifRealtime();

  // 3. Enregistre le service worker si disponible
  await registerServiceWorker();

  // 4. Si l'utilisateur a déjà accepté les notifications, on ré-abonne
  if ('Notification' in window && Notification.permission === 'granted') {
    await subscribeToPush();
  }
}


// ===== CHARGEMENT DES NOTIFICATIONS DEPUIS SUPABASE =====
async function loadNotifications() {
  if (!currentPractitioner) return;

  const { data, error } = await db
    .from('notifications')
    .select('*')
    .eq('user_id', currentPractitioner.id)
    .eq('user_type', 'kine')
    .order('created_at', { ascending: false })
    .limit(30); // On charge les 30 dernières

  if (error) {
    console.error('[Notif] Erreur chargement:', error);
    return;
  }

  renderNotifications(data || []);
}

// ===== AFFICHAGE DES NOTIFICATIONS DANS LE PANNEAU =====
function renderNotifications(notifs) {
  notificationsCache = notifs || [];

  const list = document.getElementById('notifList');
  const badge = document.getElementById('notifBadge');

  const unreadCount = notificationsCache.filter(n => !n.is_read).length;

  if (unreadCount > 0) {
    badge.style.display = 'block';
    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
  } else {
    badge.style.display = 'none';
  }

  if (!notificationsCache.length) {
    list.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--text3);font-size:13px">
        <i class="fa-solid fa-bell-slash"
           style="font-size:24px;margin-bottom:8px;display:block"></i>
        Aucune notification
      </div>`;
    return;
  }

  const typeConfig = {
    alerte_rouge:      { icon: 'fa-triangle-exclamation', color: 'rouge'  },
    alerte_inactivite: { icon: 'fa-clock',                color: 'orange' },
    nouveau_message:   { icon: 'fa-comment-medical',      color: 'blue'   },
    programme_modifie: { icon: 'fa-clipboard-list',       color: 'blue'   },
    rappel_seance:     { icon: 'fa-dumbbell',             color: 'purple' },
    felicitations:     { icon: 'fa-trophy',               color: 'green'  },
    alerte_eva:        { icon: 'fa-heart-pulse',          color: 'orange' },
    rapport_hebdo:     { icon: 'fa-chart-line',           color: 'blue'   }
  };

  list.innerHTML = notificationsCache.map((n, idx) => {
    const config = typeConfig[n.type] || { icon: 'fa-bell', color: 'blue' };
    const timeAgo = formatTimeAgo(n.created_at);

    return `
      <div class="notif-item ${n.is_read ? '' : 'unread'}"
           onclick="handleNotifClickByIndex(${idx})">
        <div class="notif-icon ${config.color}">
          <i class="fa-solid ${config.icon}"></i>
        </div>
        <div style="flex:1;min-width:0">
          <div class="notif-title">${escapeHTML(n.title)}</div>
          <div class="notif-body">${escapeHTML(n.body)}</div>
          <div class="notif-time">${escapeHTML(timeAgo)}</div>
        </div>
        ${!n.is_read ? '<div class="notif-unread-dot"></div>' : ''}
      </div>`;
  }).join('');
}

// ===== ACTIONS SUR LES NOTIFICATIONS =====
async function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  const isOpen = panel.style.display !== 'none';

  if (isOpen) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  await loadNotifications();

  // Demande permission seulement sur clic utilisateur
  if ('Notification' in window && Notification.permission === 'default') {
    const granted = await requestPushPermission();

    if (granted) {
      await subscribeToPush();
    }
  }
}

// Ferme le panneau si on clique ailleurs
document.addEventListener('click', e => {
  const panel = document.getElementById('notifPanel');
  const bell  = document.getElementById('notifBell');
  if (panel &&
      !panel.contains(e.target) &&
      !bell.contains(e.target)) {
    panel.style.display = 'none';
  }
});

async function handleNotifClickByIndex(idx) {
  const notif = notificationsCache[idx];
  if (!notif) return;

  await markNotifRead(notif.id);

  const data = notif.data || {};

  if (data.patient_id) {
    await showPatientDetail(data.patient_id);
    document.getElementById('notifPanel').style.display = 'none';

    if (notif.type === 'nouveau_message') {
      switchTab(2, document.querySelectorAll('.tab')[2]);
    }
  }
}

async function markNotifRead(notifId) {
  const { error } = await db
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notifId)
    .eq('user_id', currentPractitioner.id)
    .eq('user_type', 'kine');

  if (error) {
    console.error('[Notif] mark read error:', error);
    return;
  }

  await loadNotifications();
}

async function markAllNotifRead() {
  const { error } = await db
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', currentPractitioner.id)
    .eq('user_type', 'kine')
    .eq('is_read', false);

  if (error) {
    console.error('[Notif] mark all error:', error);
    showToast('Erreur marquage notifications', 'red');
    return;
  }

  await loadNotifications();
  showToast('Toutes les notifications marquées comme lues', 'green');
}

// ===== TEMPS RELATIF =====
function formatTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours   = Math.floor(diff / 3600000);
  const days    = Math.floor(diff / 86400000);

  if (minutes < 1)  return 'À l\'instant';
  if (minutes < 60) return `Il y a ${minutes} min`;
  if (hours < 24)   return `Il y a ${hours}h`;
  if (days === 1)   return 'Hier';
  return `Il y a ${days} jours`;
}
// Remplace tes fonctions loadPathos, savePatho et deletePatho par celles-ci :

async function loadPathos() {
  if (!currentPractitioner) return;

  const { data, error } = await db
  .from('pathologies_library')
  .select('*')
  .or(`practitioner_id.eq.${currentPractitioner.id},is_public.eq.true`)
  .order('created_at', { ascending: false });

  if (error) {
    console.error('Erreur chargement pathologies:', error);
    showToast('Erreur chargement pathologies', 'red');
    return;
  }

  pathosList = data || [];
  renderPathos();
}

function renderPathos() {
  const body = document.getElementById('pathoBody');
  if (!body) return;

  if (!pathosList.length) {
    body.innerHTML = `
      <tr>
        <td colspan="3" style="text-align:center;padding:32px;color:var(--text3)">
          <i class="fa-solid fa-book-medical" style="font-size:24px;margin-bottom:8px;display:block;opacity:.3"></i>
          Aucune pathologie. Cliquez sur "Ajouter pathologie".
        </td>
      </tr>`;
    return;
  }

  body.innerHTML = pathosList.map(p => `
    <tr>
      <td>
        <div style="font-weight:700;color:var(--text)">${escapeHTML(p.name)}</div>
        ${p.education_tip
          ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">${escapeHTML(p.education_tip.slice(0, 80))}${p.education_tip.length > 80 ? '…' : ''}</div>`
          : ''}
      </td>
      <td>
  <div style="display:flex;gap:6px;flex-wrap:wrap">
    <button class="btn btn-primary btn-sm" onclick="openMilestonesById('${p.id}')">
  <i class="fa-solid fa-timeline"></i> Frise
</button>

<button class="btn btn-secondary btn-sm" onclick="openAssessmentModalById('${p.id}')">
  <i class="fa-solid fa-clipboard-question"></i> Bilan privé
</button>
<button class="btn btn-secondary btn-sm" onclick="openPathologyFlagsModalById('${p.id}')">
  <i class="fa-solid fa-shield-heart"></i> Red Flags
</button>

  </div>
</td>
<td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm btn-icon-only" onclick="editPatho('${p.id}')">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn btn-danger btn-sm btn-icon-only" onclick="deletePatho('${p.id}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>`).join('');
}

function openMilestonesById(pathologyId){
  const p = pathosList.find(x => x.id === pathologyId);
  if(!p) { alert("Erreur : Pathologie introuvable pour la frise."); return; }
  openMilestones(p.id, p.name || 'Pathologie');
}

function openAssessmentModalById(pathologyId){
  const p = pathosList.find(x => x.id === pathologyId);
  if(!p) { alert("Erreur : Pathologie introuvable pour le bilan."); return; }
  openAssessmentModal(p.id, p.name || 'Pathologie');
}

function openPathologyFlagsModalById(pathologyId){
  const p = pathosList.find(x => x.id === pathologyId);
  if(!p) { alert("Erreur : Pathologie introuvable pour les Red Flags."); return; }
  openPathologyFlagsModal(p.id, p.name || 'Pathologie');
}

function populatePatientPathologySelect(selectedName = ''){
  const sel = document.getElementById('pPathologySelect');
  if(!sel) return;

  const options = pathosList.map(p => {
    const selected = p.name === selectedName ? 'selected' : '';
    return `
      <option value="${escapeHTML(p.name || '')}" ${selected}>
        ${escapeHTML(p.name || '')}
      </option>
    `;
  }).join('');

  sel.innerHTML = `
    <option value="">— Sélectionner une pathologie enregistrée —</option>
    ${options}
  `;
}

function handlePatientPathologySelect(){
  const sel = document.getElementById('pPathologySelect');
  const input = document.getElementById('pPathology');

  if(sel && input && sel.value){
    input.value = sel.value;
  }
}
async function addTypedPathologyFromPatientForm(){
  const input = document.getElementById('pPathology');
  const name = input.value.trim();

  if(!name){
    showToast('Saisissez d’abord le nom de la pathologie', 'red');
    return;
  }

  const alreadyExists = pathosList.some(p =>
    String(p.name || '').trim().toLowerCase() === name.toLowerCase()
  );

  if(alreadyExists){
    showToast('Cette pathologie existe déjà', 'blue');
    populatePatientPathologySelect(name);
    document.getElementById('pPathologySelect').value = name;
    return;
  }

  try {
    const { data, error } = await db
      .from('pathologies_library')
      .insert({
        practitioner_id: currentPractitioner.id,
        name,
        education_tip: ''
      })
      .select()
      .single();

    if(error) throw error;

    pathosList.unshift(data);
    populatePatientPathologySelect(name);

    document.getElementById('pPathologySelect').value = name;
    input.value = name;

    renderPathos();

    showToast('Pathologie ajoutée à votre bibliothèque', 'green');

  } catch(e) {
    console.error('Erreur ajout pathologie depuis patient:', e);
    showToast('Erreur : ' + e.message, 'red');
  }
}

let editingPathoId = null;

function openNewPatho() {
  try {
    editingPathoId = null;
    const titleEl = document.getElementById('pathoModalTitle');
    if (titleEl) titleEl.textContent = 'Nouvelle pathologie';
    
    const nameEl = document.getElementById('pathoName');
    if (nameEl) nameEl.value = '';
    
    setPathoTipValue('');
    openModal('modalPatho');
  } catch (error) {
    alert("Erreur d'ouverture Pathologie : " + error.message);
  }
}

function editPatho(id) {
  const p = pathosList.find(x => x.id === id);
  if (!p) return;
  editingPathoId = id;
  document.getElementById('pathoModalTitle').textContent = 'Modifier la pathologie';
  document.getElementById('pathoName').value = p.name || '';
  setPathoTipValue(p.education_tip || '');
  openModal('modalPatho');
}

async function savePatho() {
  try {
    const nameInput = document.getElementById('pathoName');
    const name = nameInput ? nameInput.value.trim() : '';
    const tip = getPathoTipValue().trim();

    if (!name) { 
      showToast('Le nom de la pathologie est requis', 'red'); 
      return; 
    }

    const btn = document.querySelector('#modalPatho .btn-primary');
    const oldHtml = btn ? btn.innerHTML : '<i class="fa-solid fa-floppy-disk"></i> Enregistrer';
    
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner" style="border-top-color:#fff"></span> Enregistrement...';
    }

    if (editingPathoId) {
      // MODE MODIFICATION
      const { error } = await db
        .from('pathologies_library')
        .update({ 
          name: name, 
          education_tip: tip,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingPathoId)
        .eq('practitioner_id', currentPractitioner.id);
        
      if (error) throw error;
      showToast('Pathologie modifiée !', 'green');
    } else {
      // MODE AJOUT
      const { error } = await db
        .from('pathologies_library')
        .insert({ 
          practitioner_id: currentPractitioner.id, 
          name: name, 
          education_tip: tip 
        });
        
      if (error) throw error;
      showToast('Pathologie ajoutée !', 'green');
    }

    // On ferme et on recharge
    closeModal('modalPatho');
    await loadPathos();

    // Réactivation du bouton
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }

  } catch(e) {
    console.error('Erreur détaillée savePatho:', e);
    showToast('Erreur : ' + (e.message || 'Impossible de sauvegarder'), 'red');
    
    const btn = document.querySelector('#modalPatho .btn-primary');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Enregistrer';
    }
  }
}
async function deletePatho(id) {
  if (!confirm('Supprimer cette pathologie et sa frise ?')) return;
  const { error } = await db
    .from('pathologies_library')
    .delete()
    .eq('id', id)
    .eq('practitioner_id', currentPractitioner.id);
  if (error) { showToast('Erreur suppression', 'red'); return; }
  showToast('Supprimée.', 'green');
  await loadPathos();
}

async function saveProgramAsTemplate() {
  const name = document.getElementById('progName').value.trim();

  if (!name) {
    showToast('Nom du programme requis', 'red');
    return;
  }

  const payload = {
  practitioner_id: currentPractitioner.id,
  patient_id: null,
  is_template: true,
  name,
  phase: document.getElementById('progPhase').value,
  frequency: document.getElementById('progFreq').value,
  description: document.getElementById('progDesc').value,
  prom_id: getSelectedPromIds()[0] || null,
  prom_ids: getSelectedPromIds(),
  exercises: exercisesInBuilder.map(e => {
    const c = { ...e };
    delete c._open;
    return c;
  }),
  updated_at: new Date().toISOString()
};

  try {
    const { error } = await db
      .from('programs')
      .insert(payload);

    if (error) throw error;

    await loadAllData();

    showToast('Programme enregistré comme modèle', 'green');

  } catch (e) {
    console.error('Erreur saveProgramAsTemplate:', e);
    showToast('Erreur : ' + e.message, 'red');
  }
}

// ===== REALTIME : écoute les nouvelles notifications =====

function setupNotifRealtime() {
  if (notifRealtimeStarted) return;
  notifRealtimeStarted = true;

  const notifChannel = db.channel('notifs-kine-' + currentPractitioner.id)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'notifications',
        filter: `user_id=eq.${currentPractitioner.id}`
      },
      payload => {
        const notif = payload.new;
        console.log('[Notif] Nouvelle notification reçue:', notif);

        loadNotifications();

        const panel = document.getElementById('notifPanel');
        if (panel && panel.style.display === 'none') {
          showToast(`🔔 ${notif.title}`, 'blue');
        }
      }
    )
    .subscribe(status => {
      console.log('[Notif realtime]', status);
    });

  realtimeChannels.push(notifChannel);
}

// ===== CRÉATION MANUELLE D'UNE NOTIFICATION =====
// Utilisé par les autres fonctions pour créer des alertes
async function createNotification(userId, userType, type, title, body, data = {}) {
  const { error } = await db
    .from('notifications')
    .insert({
      user_id:   userId,
      user_type: userType,
      type,
      title,
      body,
      data,
      is_read:   false
    });

  if (error) {
    console.error('[Notif] Erreur création notification:', error);
  }
}
let currentEditingPathoId = null;
let milestonesBuffer = []; // phases en cours d'édition

async function openMilestones(pathoId, name) {
  currentEditingPathoId = pathoId;
  document.getElementById('milestonePathoTitle').textContent = 'Frise : ' + name;
    cancelMilestoneEdit();

  // Remplit le sélecteur de programmes avec ceux du praticien
  const progSel = document.getElementById('mPhaseProgram');
  progSel.innerHTML = '<option value="">— Aucun programme —</option>' +
    programs.map(p => {
      const pat = patients.find(x => x.id === p.patient_id);
      const label = pat
        ? `${p.name} (${pat.first_name} ${pat.last_name})`
        : p.name;
      return `<option value="${p.id}">${escapeHTML(label)}</option>`;
    }).join('');

  // Charge les phases existantes depuis Supabase
  const { data, error } = await db
    .from('pathology_milestones')
    .select('*')
    .eq('pathology_id', pathoId)
    .order('position', { ascending: true });

  if (error) {
    console.error('Erreur chargement milestones:', error);
    milestonesBuffer = [];
  } else {
    // Normalise les données qu'elles viennent de l'ancienne ou nouvelle structure
milestonesBuffer = (data || []).map(m => ({
  id:         m.id,
  name:       m.name       || m.objective || '',
  duration:   m.duration   || (m.week_number ? `Semaine ${m.week_number}` : ''),
  objectives: m.objectives || m.objective  || '',
  means:      m.means      || '',
  criteria:   m.criteria   || '',
  color:      m.color      || '#3b82f6',
  position:   m.position   || m.week_number || 1
}));
  }

  renderMilestonesTimeline();
  openModal('modalMilestones');
}

function renderMilestonesTimeline() {
  const box = document.getElementById('milestoneTimeline');
  if (!milestonesBuffer.length) {
    box.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--text3);font-size:13px;
                  background:var(--bg);border-radius:var(--radius);border:2px dashed var(--border)">
        <i class="fa-solid fa-timeline"
           style="font-size:28px;margin-bottom:10px;display:block;opacity:.25"></i>
        Aucune phase définie.<br>
        <span style="font-size:12px">Utilisez le formulaire ci-dessous pour créer votre première phase.</span>
      </div>`;
    return;
  }

  const phaseColors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899'];

  box.innerHTML = `<div class="timeline-wrap">` +
    milestonesBuffer.map((m, i) => {
      const color = m.color || phaseColors[i % phaseColors.length];
      const prog  = programs.find(p => p.id === m.program_id);

      return `
        ${i > 0 ? `<div class="milestone-connector">Phase ${i} → Phase ${i+1}</div>` : ''}
        <div class="milestone-card" style="--dot-color:${color}">

          <!-- Header de phase -->
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
            <div style="flex:1">
              <div class="milestone-phase-badge"
                   style="background:${color}22;color:${color}">
                <i class="fa-solid fa-circle-dot"></i>
                Phase ${i + 1}
              </div>
              <div class="milestone-phase-name">${escapeHTML(m.name)}</div>
              ${m.duration ? `
                <div class="milestone-duration-tag"
                     style="background:${color}15;color:${color};border:1px solid ${color}33">
                  <i class="fa-solid fa-clock"></i>${escapeHTML(m.duration)}
                </div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">
              <button class="btn btn-secondary btn-sm btn-icon-only"
                      onclick="editMilestone(${i})" title="Modifier">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn btn-danger btn-sm btn-icon-only"
                      onclick="deleteMilestone(${i})" title="Supprimer">
                <i class="fa-solid fa-trash"></i>
              </button>
              ${i > 0 ? `
                <button class="btn btn-secondary btn-sm btn-icon-only"
                        onclick="moveMilestone(${i},-1)" title="Monter">
                  <i class="fa-solid fa-arrow-up"></i>
                </button>` : ''}
              ${i < milestonesBuffer.length - 1 ? `
                <button class="btn btn-secondary btn-sm btn-icon-only"
                        onclick="moveMilestone(${i},1)" title="Descendre">
                  <i class="fa-solid fa-arrow-down"></i>
                </button>` : ''}
            </div>
          </div>

          <!-- Objectifs -->
          ${m.objectives ? `
            <div class="milestone-section-title">
              <i class="fa-solid fa-bullseye" style="color:${color}"></i>Objectifs de rééducation
            </div>
            <div class="milestone-section-content">${escapeHTML(m.objectives)}</div>` : ''}

          <!-- Moyens -->
          ${m.means ? `
            <div class="milestone-section-title">
              <i class="fa-solid fa-screwdriver-wrench" style="color:${color}"></i>Moyens / Techniques
            </div>
            <div class="milestone-section-content">${escapeHTML(m.means)}</div>` : ''}

          <!-- Critères de passage -->
          ${m.criteria ? `
            <div class="milestone-section-title">
              <i class="fa-solid fa-clipboard-check" style="color:${color}"></i>Critères de passage
            </div>
            <div class="milestone-section-content">${escapeHTML(m.criteria)}</div>` : ''}

          <!-- Programme lié -->
          ${prog ? `
            <div class="milestone-program-tag">
              <i class="fa-solid fa-clipboard-list"></i>
              Programme lié : ${escapeHTML(prog.name)}
            </div>` : ''}

        </div>`;
    }).join('') +
  `</div>`;
}

function editMilestone(i) {
  const m = milestonesBuffer[i];
  if (!m) return;
  document.getElementById('milestoneEditIndex').value = i;
  document.getElementById('mPhaseName').value = m.name || '';
  document.getElementById('mPhaseDuration').value = m.duration || '';
  document.getElementById('mPhaseObjectives').value = m.objectives || '';
  document.getElementById('mPhaseMeans').value = m.means || '';
  document.getElementById('mPhaseCriteria').value = m.criteria || '';
  document.getElementById('mPhaseColor').value   = m.color      || '#3b82f6';
  document.getElementById('mPhaseProgram').value  = m.program_id || '';
  document.getElementById('milestoneFormTitle').textContent = 'Modifier la phase';
  document.getElementById('milestoneFormBtn').textContent = 'Mettre à jour';
  document.getElementById('cancelMilestoneBtn').style.display = 'inline-flex';
  document.getElementById('mPhaseName').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelMilestoneEdit() {
  document.getElementById('milestoneEditIndex').value = '-1';
  document.getElementById('mPhaseName').value = '';
  document.getElementById('mPhaseDuration').value = '';
  document.getElementById('mPhaseObjectives').value = '';
  document.getElementById('mPhaseMeans').value = '';
  document.getElementById('mPhaseCriteria').value = '';
  document.getElementById('mPhaseColor').value   = '#3b82f6';
  document.getElementById('mPhaseProgram').value  = '';
  document.getElementById('milestoneFormTitle').textContent = 'Ajouter une phase';
  document.getElementById('milestoneFormBtn').textContent = 'Ajouter la phase';
  document.getElementById('cancelMilestoneBtn').style.display = 'none';
}

function addOrUpdateMilestone() {
  const name = document.getElementById('mPhaseName').value.trim();
  if (!name) { showToast('Nom de phase requis', 'red'); return; }

    const phase = {
    name,
    duration:   document.getElementById('mPhaseDuration').value.trim(),
    objectives: document.getElementById('mPhaseObjectives').value.trim(),
    means:      document.getElementById('mPhaseMeans').value.trim(),
    criteria:   document.getElementById('mPhaseCriteria').value.trim(),
    color:      document.getElementById('mPhaseColor').value,
    program_id: document.getElementById('mPhaseProgram').value || null,
    position:   0
  };

  const idx = parseInt(document.getElementById('milestoneEditIndex').value, 10);

  if (idx >= 0) {
    phase.id = milestonesBuffer[idx].id || null;
    milestonesBuffer[idx] = { ...milestonesBuffer[idx], ...phase };
    showToast('Phase mise à jour', 'green');
  } else {
    milestonesBuffer.push(phase);
    showToast('Phase ajoutée', 'green');
  }

  milestonesBuffer = milestonesBuffer.map((m, i) => ({ ...m, position: i + 1 }));
  cancelMilestoneEdit();
  renderMilestonesTimeline();
}

function deleteMilestone(i) {
  if (!confirm('Supprimer cette phase ?')) return;
  milestonesBuffer.splice(i, 1);
  milestonesBuffer = milestonesBuffer.map((m, idx) => ({ ...m, position: idx + 1 }));
  renderMilestonesTimeline();
  showToast('Phase supprimée', 'green');
}

function moveMilestone(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= milestonesBuffer.length) return;
  [milestonesBuffer[i], milestonesBuffer[j]] = [milestonesBuffer[j], milestonesBuffer[i]];
  milestonesBuffer = milestonesBuffer.map((m, idx) => ({ ...m, position: idx + 1 }));
  renderMilestonesTimeline();
}

async function saveMilestones() {
  if (!currentEditingPathoId) return;

  const btn = document.querySelector('#modalMilestones .btn-primary');
  if (btn) { btn.disabled = true; }

  try {
    const { error: delError } = await db
      .from('pathology_milestones')
      .delete()
      .eq('pathology_id', currentEditingPathoId);

    if (delError) throw delError;

    if (milestonesBuffer.length) {
      const rows = milestonesBuffer.map((m, i) => ({
        pathology_id:    currentEditingPathoId,
        practitioner_id: currentPractitioner.id,
        name:            m.name       || '',
        duration:        m.duration   || null,
        objectives:      m.objectives || null,
        means:           m.means      || null,
        criteria:        m.criteria   || null,
        color:           m.color      || '#3b82f6',
        position:        i + 1,
        week_number:     i + 1
      }));

      const { error: insError } = await db
        .from('pathology_milestones')
        .insert(rows);

      if (insError) throw insError;
    }

    showToast('Frise sauvegardée !', 'green');
    closeModal('modalMilestones');

  } catch(e) {
    console.error('Erreur saveMilestones:', e);
    showToast('Erreur : ' + e.message, 'red');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================
// SYSTÈME PROMs COMPLET
// ============================================================
let questionsBuilder = [];
let editingPromId = null;

function openNewProm() {
  editingPromId = null;
  document.getElementById('promTitle').value = '';
  document.getElementById('promScoreMode').value = 'sum';
  document.getElementById('promScoreMax').value = '';
  document.getElementById('promDescription').value = '';
  questionsBuilder = [];
  renderQuestionsBuilder();
  document.getElementById('promBuilderCard').style.display = 'block';
  document.getElementById('promTitle').scrollIntoView({ behavior: 'smooth' });
}

function closeProm() {
  document.getElementById('promBuilderCard').style.display = 'none';
  editingPromId = null;
  questionsBuilder = [];
}

function addQuestionRow() {
  questionsBuilder.push({
    question: '',
    type: 'scale',
    min: 0,
    max: 10,
    weight: 1,
    invert: false,
    options: ''
  });
  renderQuestionsBuilder();
}

function removeQuestionRow(i) {
  questionsBuilder.splice(i, 1);
  renderQuestionsBuilder();
}

function moveQuestion(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= questionsBuilder.length) return;
  [questionsBuilder[i], questionsBuilder[j]] = [questionsBuilder[j], questionsBuilder[i]];
  renderQuestionsBuilder();
}

function renderQuestionsBuilder() {
  const container = document.getElementById('dynamicQuestions');
  if (!questionsBuilder.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;
                  background:var(--bg);border-radius:var(--radius);border:1px dashed var(--border)">
        Aucune question. Cliquez sur "+ Ajouter une question".
      </div>`;
    return;
  }

  container.innerHTML = questionsBuilder.map((q, i) => `
    <div style="border:1.5px solid var(--border);border-radius:var(--radius);
                background:var(--card);padding:14px;margin-bottom:8px">

      <!-- Ligne de contrôle -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="width:24px;height:24px;background:var(--accent);color:#fff;
                     border-radius:7px;display:flex;align-items:center;justify-content:center;
                     font-size:11px;font-weight:800;flex-shrink:0">${i + 1}</span>
        <select class="form-select" style="max-width:160px"
                onchange="questionsBuilder[${i}].type=this.value;renderQuestionsBuilder()">
          <option value="scale"   ${q.type==='scale'   ?'selected':''}>Échelle (0-10)</option>
          <option value="number"  ${q.type==='number'  ?'selected':''}>Nombre libre</option>
          <option value="yesno"   ${q.type==='yesno'   ?'selected':''}>Oui / Non</option>
          <option value="choice"  ${q.type==='choice'  ?'selected':''}>Choix multiple</option>
          <option value="text"    ${q.type==='text'    ?'selected':''}>Texte libre</option>
        </select>
        <div style="margin-left:auto;display:flex;gap:4px">
          ${i > 0 ? `<button class="btn btn-secondary btn-sm btn-icon-only" onclick="moveQuestion(${i},-1)"><i class="fa-solid fa-arrow-up"></i></button>` : ''}
          ${i < questionsBuilder.length-1 ? `<button class="btn btn-secondary btn-sm btn-icon-only" onclick="moveQuestion(${i},1)"><i class="fa-solid fa-arrow-down"></i></button>` : ''}
          <button class="btn btn-danger btn-sm btn-icon-only" onclick="removeQuestionRow(${i})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>

      <!-- Intitulé de la question -->
      <div class="form-group" style="margin-bottom:8px">
        <label class="form-label">Intitulé</label>
        <input class="form-input" placeholder="Ex: Évaluez votre douleur actuelle"
               value="${escapeHTML(q.question)}"
               oninput="questionsBuilder[${i}].question=this.value"/>
      </div>

      <!-- Options selon le type -->
      ${q.type === 'scale' || q.type === 'number' ? `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">
          <div class="form-group">
            <label class="form-label">Min</label>
            <input class="form-input" type="number" value="${q.min ?? 0}"
                   oninput="questionsBuilder[${i}].min=+this.value"/>
          </div>
          <div class="form-group">
            <label class="form-label">Max</label>
            <input class="form-input" type="number" value="${q.max ?? 10}"
                   oninput="questionsBuilder[${i}].max=+this.value"/>
          </div>
          <div class="form-group">
            <label class="form-label">Coefficient</label>
            <input class="form-input" type="number" value="${q.weight ?? 1}" min="0" step="0.1"
                   oninput="questionsBuilder[${i}].weight=+this.value"/>
          </div>
          <div class="form-group" style="justify-content:flex-end;padding-top:20px">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);cursor:pointer">
              <input type="checkbox" ${q.invert ? 'checked' : ''}
                     onchange="questionsBuilder[${i}].invert=this.checked"/>
              Inverser le score
            </label>
          </div>
        </div>` : ''}

      ${q.type === 'choice' ? `
        <div class="form-group">
          <label class="form-label">Options (séparées par |)</label>
          <input class="form-input" placeholder="Jamais|Parfois|Souvent|Toujours"
                 value="${escapeHTML(q.options || '')}"
                 oninput="questionsBuilder[${i}].options=this.value"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="form-group">
            <label class="form-label">Coefficient</label>
            <input class="form-input" type="number" value="${q.weight ?? 1}" min="0" step="0.1"
                   oninput="questionsBuilder[${i}].weight=+this.value"/>
          </div>
        </div>` : ''}

      ${q.type === 'yesno' ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="form-group">
            <label class="form-label">Score si Oui</label>
            <input class="form-input" type="number" value="${q.scoreYes ?? 1}"
                   oninput="questionsBuilder[${i}].scoreYes=+this.value"/>
          </div>
          <div class="form-group">
            <label class="form-label">Score si Non</label>
            <input class="form-input" type="number" value="${q.scoreNo ?? 0}"
                   oninput="questionsBuilder[${i}].scoreNo=+this.value"/>
          </div>
        </div>` : ''}

      ${q.type === 'text' ? `
        <div class="rgpd-notice" style="margin-top:4px">
          <i class="fa-solid fa-circle-info"></i>
          Réponse texte libre — ne contribue pas au score calculé.
        </div>` : ''}
    </div>`).join('');
}

async function savePromTemplate() {
  const title = document.getElementById('promTitle').value.trim();
  const scoreMode = document.getElementById('promScoreMode').value;
  const scoreMax  = document.getElementById('promScoreMax').value.trim();
  const description = document.getElementById('promDescription').value.trim();

  if (!title) { showToast('Titre requis', 'red'); return; }
  if (!questionsBuilder.length) { showToast('Ajoutez au moins une question', 'red'); return; }

  const hasEmptyQuestion = questionsBuilder.some(q => !q.question.trim());
  if (hasEmptyQuestion) { showToast('Renseignez tous les intitulés de questions', 'red'); return; }

  const btn = document.getElementById('savePromBtn');
  if (btn) { btn.disabled = true; }

  const payload = {
    practitioner_id: currentPractitioner.id,
    title,
    description,
    questions: JSON.stringify(questionsBuilder),
    score_mode: scoreMode,
    score_max: scoreMax ? parseFloat(scoreMax) : null,
    updated_at: new Date().toISOString()
  };

  try {
    if (editingPromId) {
      const { error } = await db
        .from('prom_templates')
        .update(payload)
        .eq('id', editingPromId)
        .eq('practitioner_id', currentPractitioner.id);
      if (error) throw error;
      showToast('Questionnaire mis à jour !', 'green');
    } else {
      const { error } = await db
        .from('prom_templates')
        .insert(payload);
      if (error) throw error;
      showToast('Questionnaire sauvegardé !', 'green');
    }

    editingPromId = null;
    questionsBuilder = [];
    document.getElementById('promBuilderCard').style.display = 'none';
    await loadPromList();

  } catch(e) {
    showToast('Erreur : ' + e.message, 'red');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function editProm(id) {
  const { data, error } = await db
    .from('prom_templates')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) { showToast('Erreur chargement', 'red'); return; }

  editingPromId = id;
  document.getElementById('promTitle').value = data.title || '';
  document.getElementById('promScoreMode').value = data.score_mode || 'sum';
  document.getElementById('promScoreMax').value = data.score_max || '';
  document.getElementById('promDescription').value = data.description || '';

  try {
    questionsBuilder = JSON.parse(data.questions || '[]');
  } catch(e) {
    questionsBuilder = [];
  }

  renderQuestionsBuilder();
  document.getElementById('promBuilderCard').style.display = 'block';
  document.getElementById('promTitle').scrollIntoView({ behavior: 'smooth' });
}

async function deleteProm(id) {
  if (!confirm('Supprimer ce questionnaire ?')) return;
  const { error } = await db
    .from('prom_templates')
    .delete()
    .eq('id', id)
    .eq('practitioner_id', currentPractitioner.id);
  if (error) { showToast('Erreur suppression', 'red'); return; }
  showToast('Questionnaire supprimé.', 'green');
  await loadPromList();
}

async function loadPromList() {
  const { data, error } = await db
    .from('prom_templates')
    .select('*')
    .eq('practitioner_id', currentPractitioner.id)
    .order('created_at', { ascending: false });

  // ← AJOUTE cette ligne
  promsCache = data || [];

  const box = document.getElementById('promList');
  // ... reste inchangé

  if (!box) return;

  if (error || !data || !data.length) {
    box.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--text3);font-size:13px">
        <i class="fa-solid fa-file-signature"
           style="font-size:28px;margin-bottom:10px;display:block;opacity:.3"></i>
        Aucun questionnaire créé.
      </div>`;
    return;
  }

  const scoreModeLabel = {
    sum:     'Somme des scores',
    average: 'Moyenne des scores',
    percent: 'Pourcentage du max'
  };

  box.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Titre</th>
          <th>Questions</th>
          <th>Calcul du score</th>
          <th>Score max</th>
          <th>Créé le</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(p => {
          let questions = [];
          try { questions = JSON.parse(p.questions || '[]'); } catch(e) {}
          const scorable = questions.filter(q => q.type !== 'text').length;
          return `
            <tr>
              <td>
                <div style="font-weight:700;color:var(--text)">${escapeHTML(p.title)}</div>
                ${p.description
                  ? `<div style="font-size:11px;color:var(--text3)">${escapeHTML(p.description.slice(0,60))}${p.description.length>60?'…':''}</div>`
                  : ''}
              </td>
              <td>
                <span class="badge badge-blue">${questions.length} question(s)</span>
                <div style="font-size:10px;color:var(--text3);margin-top:2px">${scorable} scorable(s)</div>
              </td>
              <td><span class="badge badge-gray">${scoreModeLabel[p.score_mode] || 'Somme'}</span></td>
              <td>${p.score_max ? `<span class="badge badge-purple" style="background:rgba(139,92,246,.15);color:#7c3aed">${p.score_max} pts</span>` : '<span style="color:var(--text3);font-size:12px">Auto</span>'}</td>
              <td style="font-size:11px;color:var(--text3)">${new Date(p.created_at).toLocaleDateString('fr-FR')}</td>
              <td>
                <div style="display:flex;gap:6px">
                  <button class="btn btn-secondary btn-sm btn-icon-only" onclick="editProm('${p.id}')" title="Modifier">
                    <i class="fa-solid fa-pen"></i>
                  </button>
                  <button class="btn btn-danger btn-sm btn-icon-only" onclick="deleteProm('${p.id}')" title="Supprimer">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}
// ============================================================
// BILAN PRIVÉ DE PATHOLOGIE
// ============================================================

async function openAssessmentModal(pathologyId, pathologyName){
  currentAssessmentPathologyId = pathologyId;
  currentAssessmentPathologyName = pathologyName;

  document.getElementById('assessmentModalTitle').innerHTML = `
    <i class="fa-solid fa-clipboard-question" style="color:var(--accent)"></i>
    Bilan privé : ${escapeHTML(pathologyName)}
  `;

  document.getElementById('assessmentDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('assessmentTitle').value = 'Bilan';
  document.getElementById('assessmentNotes').value = '';

  document.getElementById('assessmentSaveFeedback')?.remove();

  const patientSel = document.getElementById('assessmentPatient');

  const pathologyNorm = String(pathologyName || '').trim().toLowerCase();

  const matchingPatients = patients.filter(p =>
    String(p.pathology || '').trim().toLowerCase() === pathologyNorm
  );

  const listForSelect = matchingPatients.length ? matchingPatients : patients;

  patientSel.innerHTML = `
    <option value="">— Sélectionner un patient —</option>
    ${listForSelect.map(p => `
      <option value="${p.id}">
        ${escapeHTML(p.first_name)} ${escapeHTML(p.last_name)}
        ${p.pathology ? ` — ${escapeHTML(p.pathology)}` : ''}
      </option>
    `).join('')}
  `;

  if(currentPatientId && listForSelect.some(p => p.id === currentPatientId)){
    patientSel.value = currentPatientId;
  }

  await loadAssessmentTemplate();
  await loadAssessmentHistory();
  await populateAssessmentTemplateSelector();

  renderAssessmentTemplateBuilder();
  renderAssessmentForm();

  switchAssessmentTab(1, document.querySelectorAll('#modalAssessment .tab')[1]);

  openModal('modalAssessment');
}

function switchAssessmentTab(n, el){
  [0,1,2].forEach(i => {
    document.getElementById('assessmentTab' + i).style.display = i === n ? 'block' : 'none';
  });

  document.querySelectorAll('#modalAssessment .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');

  if(n === 1) renderAssessmentForm();
  if(n === 2) loadAssessmentHistory();
}

async function loadAssessmentTemplate(){
  const { data, error } = await db
    .from('pathology_assessment_templates')
    .select('*')
    .eq('pathology_id', currentAssessmentPathologyId)
    .eq('practitioner_id', currentPractitioner.id)
    .maybeSingle();

  if(error){
    console.error('Erreur template bilan:', error);
    showToast('Erreur chargement modèle bilan', 'red');
    return;
  }

  if(data){
    assessmentTemplate = {
      id: data.id,
      title: data.title || 'Bilan de la pathologie',
      sections: Array.isArray(data.sections) ? data.sections : []
    };
  } else {
    assessmentTemplate = {
      id: null,
      title: 'Bilan de la pathologie',
      sections: []
    };
  }
}

function loadDefaultAssessmentTemplate(){
  assessmentTemplate.sections = [
    {
      id: generateUUID(),
      title: 'Anamnèse',
      icon: 'fa-comments',
      fields: [
        { id: generateUUID(), label: 'Motif de consultation', type: 'textarea' },
        { id: generateUUID(), label: 'Mode d’apparition', type: 'textarea' },
        { id: generateUUID(), label: 'Antécédents pertinents', type: 'textarea' }
      ]
    },
    {
      id: generateUUID(),
      title: 'Douleur',
      icon: 'fa-heart-pulse',
      fields: [
        { id: generateUUID(), label: 'EVA repos', type: 'number', min: 0, max: 10 },
        { id: generateUUID(), label: 'EVA effort', type: 'number', min: 0, max: 10 },
        { id: generateUUID(), label: 'Localisation', type: 'text' },
        { id: generateUUID(), label: 'Facteurs aggravants / soulageants', type: 'textarea' }
      ]
    },
    {
      id: generateUUID(),
      title: 'Bilan articulaire',
      icon: 'fa-arrows-left-right',
      fields: [
        { id: generateUUID(), label: 'Mobilité active', type: 'textarea' },
        { id: generateUUID(), label: 'Mobilité passive', type: 'textarea' },
        { id: generateUUID(), label: 'Limitations principales', type: 'textarea' }
      ]
    },
    {
      id: generateUUID(),
      title: 'Bilan musculaire',
      icon: 'fa-dumbbell',
      fields: [
        { id: generateUUID(), label: 'Force globale', type: 'textarea' },
        { id: generateUUID(), label: 'Groupes déficitaires', type: 'textarea' },
        { id: generateUUID(), label: 'Endurance / fatigabilité', type: 'textarea' }
      ]
    },
    {
      id: generateUUID(),
      title: 'Tests spécifiques',
      icon: 'fa-vial-circle-check',
      fields: [
        { id: generateUUID(), label: 'Test 1 - nom', type: 'text' },
        { id: generateUUID(), label: 'Test 1 - résultat', type: 'choice', options: 'Négatif|Positif|Douteux' },
        { id: generateUUID(), label: 'Commentaires tests', type: 'textarea' }
      ]
    }
  ];

  renderAssessmentTemplateBuilder();
  renderAssessmentForm();
  showToast('Modèle de base chargé', 'green');
}

function renderAssessmentTemplateBuilder(){
  const box = document.getElementById('assessmentTemplateBuilder');
  if(!box) return;

  if(!assessmentTemplate.sections.length){
    box.innerHTML = `
      <div style="text-align:center;padding:28px;color:var(--text3);
                  border:2px dashed var(--border);border-radius:var(--radius);background:var(--bg)">
        <i class="fa-solid fa-clipboard-question"
           style="font-size:28px;margin-bottom:10px;display:block;opacity:.35"></i>
        Aucun modèle de bilan configuré pour cette pathologie.
        <br>
        <span style="font-size:12px">Cliquez sur “Charger modèle de base” ou ajoutez vos sections.</span>
      </div>
    `;
    return;
  }

  box.innerHTML = assessmentTemplate.sections.map((section, sIndex) => `
    <div class="assessment-section-card" style="margin-bottom:12px">
      <div class="assessment-section-header">
        <div class="assessment-section-title">
          <i class="fa-solid ${escapeHTML(section.icon || 'fa-folder')}" style="color:var(--accent)"></i>
          <input class="form-input"
            style="font-weight:800"
            value="${escapeHTML(section.title)}"
            oninput="assessmentTemplate.sections[${sIndex}].title=this.value"/>
        </div>

        <div style="display:flex;gap:5px">
          <button class="btn btn-secondary btn-sm btn-icon-only" onclick="addAssessmentField(${sIndex})" title="Ajouter champ">
            <i class="fa-solid fa-plus"></i>
          </button>

          <button class="btn btn-danger btn-sm btn-icon-only" onclick="removeAssessmentSection(${sIndex})" title="Supprimer section">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>

      <div style="padding:12px">
        <div class="form-group" style="margin-bottom:10px">
          <label class="form-label">Icône FontAwesome</label>
          <input class="form-input"
            placeholder="ex: fa-heart-pulse"
            value="${escapeHTML(section.icon || '')}"
            oninput="assessmentTemplate.sections[${sIndex}].icon=this.value"/>
        </div>

        ${
          section.fields && section.fields.length
            ? section.fields.map((field, fIndex) => renderAssessmentFieldBuilder(section, sIndex, field, fIndex)).join('')
            : `<div class="flags-empty">Aucun champ dans cette section.</div>`
        }
      </div>
    </div>
  `).join('');
}

function renderAssessmentFieldBuilder(section, sIndex, field, fIndex){
  return `
    <div class="assessment-field-card" style="margin-bottom:8px">
      <div style="display:grid;grid-template-columns:1fr 150px auto;gap:8px;align-items:center">
        <input class="form-input"
          placeholder="Nom du champ"
          value="${escapeHTML(field.label || '')}"
          oninput="assessmentTemplate.sections[${sIndex}].fields[${fIndex}].label=this.value"/>

        <select class="form-select"
          onchange="assessmentTemplate.sections[${sIndex}].fields[${fIndex}].type=this.value;renderAssessmentTemplateBuilder();">
          <option value="text" ${field.type === 'text' ? 'selected' : ''}>Texte court</option>
          <option value="textarea" ${field.type === 'textarea' ? 'selected' : ''}>Texte long</option>
          <option value="number" ${field.type === 'number' ? 'selected' : ''}>Nombre</option>
          <option value="choice" ${field.type === 'choice' ? 'selected' : ''}>Choix</option>
          <option value="date" ${field.type === 'date' ? 'selected' : ''}>Date</option>
        </select>

        <button class="btn btn-danger btn-sm btn-icon-only"
          onclick="removeAssessmentField(${sIndex}, ${fIndex})"
          title="Supprimer le champ">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>

      ${field.type === 'choice' ? `
        <div class="form-group" style="margin-top:8px">
          <label class="form-label">Options séparées par |</label>
          <input class="form-input"
            placeholder="Ex: Négatif|Positif|Douteux"
            value="${escapeHTML(field.options || '')}"
            oninput="assessmentTemplate.sections[${sIndex}].fields[${fIndex}].options=this.value"/>
        </div>
      ` : ''}

      ${field.type === 'number' ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <div class="form-group">
            <label class="form-label">Min</label>
            <input class="form-input"
              type="number"
              value="${field.min ?? ''}"
              oninput="assessmentTemplate.sections[${sIndex}].fields[${fIndex}].min=this.value === '' ? null : Number(this.value)"/>
          </div>
          <div class="form-group">
            <label class="form-label">Max</label>
            <input class="form-input"
              type="number"
              value="${field.max ?? ''}"
              oninput="assessmentTemplate.sections[${sIndex}].fields[${fIndex}].max=this.value === '' ? null : Number(this.value)"/>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function addAssessmentSection(){
  assessmentTemplate.sections.push({
    id: generateUUID(),
    title: 'Nouvelle section',
    icon: 'fa-folder',
    fields: []
  });

  renderAssessmentTemplateBuilder();
  renderAssessmentForm();
}

function removeAssessmentSection(index){
  if(!confirm('Supprimer cette section ?')) return;

  assessmentTemplate.sections.splice(index, 1);

  renderAssessmentTemplateBuilder();
  renderAssessmentForm();
}

function addAssessmentField(sectionIndex){
  if(!assessmentTemplate.sections[sectionIndex]) return;

  if(!Array.isArray(assessmentTemplate.sections[sectionIndex].fields)){
    assessmentTemplate.sections[sectionIndex].fields = [];
  }

  assessmentTemplate.sections[sectionIndex].fields.push({
    id: generateUUID(),
    label: 'Nouveau champ',
    type: 'text'
  });

  renderAssessmentTemplateBuilder();
  renderAssessmentForm();
}

function removeAssessmentField(sectionIndex, fieldIndex){
  if(!assessmentTemplate.sections[sectionIndex]) return;
  if(!assessmentTemplate.sections[sectionIndex].fields) return;

  assessmentTemplate.sections[sectionIndex].fields.splice(fieldIndex, 1);

  renderAssessmentTemplateBuilder();
  renderAssessmentForm();
}

async function saveAssessmentTemplate(){
  if(!currentAssessmentPathologyId || !currentPractitioner){
    showToast('Pathologie ou praticien introuvable', 'red');
    return;
  }

  // === DEBUG : on affiche ce qu'on a ===
  console.log('[SAVE TEMPLATE] pathologyId:', currentAssessmentPathologyId);
  console.log('[SAVE TEMPLATE] practitionerId:', currentPractitioner.id);
  console.log('[SAVE TEMPLATE] sections:', assessmentTemplate.sections);

  const cleanedSections = (assessmentTemplate.sections || []).map(section => ({
    id: section.id || generateUUID(),
    title: String(section.title || '').trim() || 'Section',
    icon: String(section.icon || 'fa-folder').trim() || 'fa-folder',
    fields: Array.isArray(section.fields)
      ? section.fields.map(field => ({
          id: field.id || generateUUID(),
          label: String(field.label || '').trim() || 'Champ',
          type: field.type || 'text',
          options: field.options || '',
          min: field.min ?? null,
          max: field.max ?? null
        }))
      : []
  }));

  console.log('[SAVE TEMPLATE] cleanedSections:', cleanedSections);

  const payload = {
    practitioner_id: currentPractitioner.id,
    pathology_id: currentAssessmentPathologyId,
    title: assessmentTemplate.title || 'Bilan de la pathologie',
    sections: cleanedSections,
    updated_at: new Date().toISOString()
  };

  console.log('[SAVE TEMPLATE] payload final:', payload);

  try {
    // ÉTAPE 1 : vérifier si un modèle existe déjà
    console.log('[SAVE TEMPLATE] Vérification existence...');

    const { data: existing, error: checkError } = await db
      .from('pathology_assessment_templates')
      .select('id')
      .eq('practitioner_id', currentPractitioner.id)
      .eq('pathology_id', currentAssessmentPathologyId)
      .maybeSingle();

    console.log('[SAVE TEMPLATE] existing:', existing);
    console.log('[SAVE TEMPLATE] checkError:', checkError);

    if(checkError) throw checkError;

    let savedData = null;

    if(existing){
      console.log('[SAVE TEMPLATE] → UPDATE id:', existing.id);

      const { data, error } = await db
        .from('pathology_assessment_templates')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();

      console.log('[SAVE TEMPLATE] UPDATE result:', data);
      console.log('[SAVE TEMPLATE] UPDATE error:', error);

      if(error) throw error;
      savedData = data;

    } else {
      console.log('[SAVE TEMPLATE] → INSERT');

      const { data, error } = await db
        .from('pathology_assessment_templates')
        .insert(payload)
        .select()
        .single();

      console.log('[SAVE TEMPLATE] INSERT result:', data);
      console.log('[SAVE TEMPLATE] INSERT error:', error);

      if(error) throw error;
      savedData = data;
    }

    assessmentTemplate = {
      id: savedData.id,
      title: savedData.title || 'Bilan de la pathologie',
      sections: Array.isArray(savedData.sections) ? savedData.sections : []
    };

    renderAssessmentTemplateBuilder();
    renderAssessmentForm();
    showToast('Modèle de bilan sauvegardé ✓', 'green');

  } catch(e) {
    console.error('[SAVE TEMPLATE] ERREUR COMPLÈTE:', e);
    console.error('[SAVE TEMPLATE] code:', e.code);
    console.error('[SAVE TEMPLATE] message:', e.message);
    console.error('[SAVE TEMPLATE] details:', e.details);
    console.error('[SAVE TEMPLATE] hint:', e.hint);
    showToast('Erreur : ' + e.message, 'red');
  }
}

function renderAssessmentForm(){
  const box = document.getElementById('assessmentFormContainer');
  if(!box) return;

  if(!assessmentTemplate.sections.length){
    box.innerHTML = `
      <div class="alert alert-warn">
        <i class="fa-solid fa-circle-info"></i>
        <div>Aucun modèle de bilan configuré. Créez d'abord un modèle dans l'onglet “Modèle de bilan”.</div>
      </div>
    `;
    return;
  }

  box.innerHTML = assessmentTemplate.sections.map(section => `
    <div class="assessment-section-card">
      <div class="assessment-section-header">
        <div class="assessment-section-title">
          <i class="fa-solid ${escapeHTML(section.icon || 'fa-folder')}" style="color:var(--accent)"></i>
          ${escapeHTML(section.title || 'Section')}
        </div>
      </div>

      <div class="assessment-section-body">
        ${
          section.fields && section.fields.length
            ? section.fields.map(field => renderAssessmentInput(field)).join('')
            : `<div class="flags-empty">Aucun champ dans cette section.</div>`
        }
      </div>
    </div>
  `).join('');
}

function renderAssessmentInput(field){
  const fieldId = `assessmentField_${field.id}`;

  if(field.type === 'textarea'){
    return `
      <div class="form-group full">
        <label class="form-label">${escapeHTML(field.label || 'Champ')}</label>
        <textarea class="form-textarea" id="${fieldId}" data-assessment-field="${escapeHTML(field.id)}"></textarea>
      </div>
    `;
  }

  if(field.type === 'number'){
    return `
      <div class="form-group">
        <label class="form-label">${escapeHTML(field.label || 'Champ')}</label>
        <input class="form-input"
          type="number"
          id="${fieldId}"
          data-assessment-field="${escapeHTML(field.id)}"
          ${field.min !== null && field.min !== undefined ? `min="${escapeHTML(field.min)}"` : ''}
          ${field.max !== null && field.max !== undefined ? `max="${escapeHTML(field.max)}"` : ''}/>
      </div>
    `;
  }

  if(field.type === 'choice'){
    const options = String(field.options || '')
      .split('|')
      .map(o => o.trim())
      .filter(Boolean);

    return `
      <div class="form-group">
        <label class="form-label">${escapeHTML(field.label || 'Champ')}</label>
        <select class="form-select" id="${fieldId}" data-assessment-field="${escapeHTML(field.id)}">
          <option value="">— Sélectionner —</option>
          ${options.map(o => `<option value="${escapeHTML(o)}">${escapeHTML(o)}</option>`).join('')}
        </select>
      </div>
    `;
  }

  if(field.type === 'date'){
    return `
      <div class="form-group">
        <label class="form-label">${escapeHTML(field.label || 'Champ')}</label>
        <input class="form-input" type="date" id="${fieldId}" data-assessment-field="${escapeHTML(field.id)}"/>
      </div>
    `;
  }

  return `
    <div class="form-group">
      <label class="form-label">${escapeHTML(field.label || 'Champ')}</label>
      <input class="form-input" type="text" id="${fieldId}" data-assessment-field="${escapeHTML(field.id)}"/>
    </div>
  `;
}

async function saveAssessmentEntry(){
  if(!currentAssessmentPathologyId || !currentPractitioner) {
    showToast('Pathologie ou praticien introuvable', 'red');
    return;
  }

  const selectedPatientId = document.getElementById('assessmentPatient').value;

  if(!selectedPatientId){
    showToast('Sélectionnez un patient pour enregistrer ce bilan', 'red');
    return;
  }

  const values = {};

  document.querySelectorAll('[data-assessment-field]').forEach(el => {
    values[el.dataset.assessmentField] = el.value;
  });

  const payload = {
    practitioner_id: currentPractitioner.id,
    pathology_id: currentAssessmentPathologyId,
    patient_id: selectedPatientId,
    title: document.getElementById('assessmentTitle').value.trim() || 'Bilan',
    assessment_date: document.getElementById('assessmentDate').value || new Date().toISOString().slice(0,10),
    template_snapshot: assessmentTemplate,
    values,
    notes: document.getElementById('assessmentNotes').value.trim()
  };

  const btn = document.querySelector('#assessmentTab1 .btn-primary');
  const oldHtml = btn ? btn.innerHTML : '';

  if(btn){
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner" style="border-top-color:#fff"></span> Enregistrement...';
  }

  try {
    const { data, error } = await db
      .from('pathology_assessment_entries')
      .insert(payload)
      .select()
      .single();

    if(error) throw error;

    showToast('Bilan enregistré pour ce patient', 'green');

    console.log('[BILAN ENREGISTRÉ]', data);

    document.getElementById('assessmentSaveFeedback')?.remove();

    const feedback = document.createElement('div');
    feedback.id = 'assessmentSaveFeedback';
    feedback.className = 'alert';
    feedback.style.background = '#ecfdf5';
    feedback.style.border = '1px solid #10b981';
    feedback.style.color = '#065f46';
    feedback.innerHTML = `
      <i class="fa-solid fa-circle-check"></i>
      <div>
        Bilan enregistré avec succès.
        <br>
        <span style="font-size:11px">
          Patient : ${escapeHTML(
            patients.find(p => p.id === selectedPatientId)?.first_name || ''
          )} ${escapeHTML(
            patients.find(p => p.id === selectedPatientId)?.last_name || ''
          )}
        </span>
      </div>
    `;

    const tab = document.getElementById('assessmentTab1');
    tab.insertBefore(feedback, tab.firstChild);

    await loadAssessmentHistory();

    if(currentPatientId === selectedPatientId){
      await renderPatientAssessments(selectedPatientId);
    }

  } catch(e) {
    console.error('Erreur sauvegarde bilan:', e);
    showToast('Erreur sauvegarde bilan : ' + e.message, 'red');
  } finally {
    if(btn){
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }
  }
}

async function loadAssessmentHistory(){
  if(!currentAssessmentPathologyId || !currentPractitioner) return;

  const selectedPatientId = document.getElementById('assessmentPatient')?.value;

  if(!selectedPatientId){
    assessmentHistoryCache = [];
    renderAssessmentHistory();
    return;
  }

  const { data, error } = await db
    .from('pathology_assessment_entries')
    .select('*')
    .eq('pathology_id', currentAssessmentPathologyId)
    .eq('practitioner_id', currentPractitioner.id)
    .eq('patient_id', selectedPatientId)
    .order('assessment_date', { ascending:false });

  if(error){
    console.error('Erreur historique bilan:', error);
    assessmentHistoryCache = [];
  } else {
    assessmentHistoryCache = data || [];
  }

  renderAssessmentHistory();
}

function renderAssessmentHistory(){
  const box = document.getElementById('assessmentHistory');
  if(!box) return;

  if(!assessmentHistoryCache.length){
  const selectedPatientId = document.getElementById('assessmentPatient')?.value;
  const patient = patients.find(p => p.id === selectedPatientId);

  box.innerHTML = `
    <div style="text-align:center;padding:28px;color:var(--text3);
                border:1px dashed var(--border);border-radius:var(--radius);background:var(--bg)">
      ${
        patient
          ? `Aucun bilan enregistré pour ${escapeHTML(patient.first_name)} ${escapeHTML(patient.last_name)}.`
          : `Sélectionnez un patient pour voir son historique.`
      }
    </div>
  `;
  return;
}

  box.innerHTML = assessmentHistoryCache.map(entry => {
    const patient = patients.find(p => p.id === entry.patient_id);

    return `
      <div class="assessment-history-item">
        <div class="assessment-history-title">
          ${escapeHTML(entry.title || 'Bilan')}
        </div>
        <div class="assessment-history-meta">
          ${new Date(entry.assessment_date || entry.created_at).toLocaleDateString('fr-FR')}
          ${patient ? ` · ${escapeHTML(patient.first_name)} ${escapeHTML(patient.last_name)}` : ''}
        </div>
        ${entry.notes ? `
          <div style="font-size:12px;color:var(--text2);margin-top:8px">
            ${escapeHTML(entry.notes)}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}
// ============================================================
// CHARGEMENT D'UN BILAN SAUVEGARDÉ COMME MODÈLE
// ============================================================

async function populateAssessmentTemplateSelector(){
  const sel = document.getElementById('assessmentTemplateSelector');
  if(!sel || !currentPractitioner) return;

  sel.innerHTML = `<option value="">— Nouveau bilan vierge —</option>`;

  if(!currentAssessmentPathologyId) return;

  try {
    // === PARTIE 1 : Modèles sauvegardés (pathology_assessment_templates) ===
    const { data: templates, error: tError } = await db
      .from('pathology_assessment_templates')
      .select('id, title, updated_at')
      .eq('practitioner_id', currentPractitioner.id)
      .eq('pathology_id', currentAssessmentPathologyId)
      .order('updated_at', { ascending: false });

    if(tError) throw tError;

    if(templates && templates.length){
      // Groupe optgroup pour les modèles
      const groupModels = document.createElement('optgroup');
      groupModels.label = '── Modèles de structure ──';
      sel.appendChild(groupModels);

      templates.forEach(t => {
        const dateStr = t.updated_at
          ? new Date(t.updated_at).toLocaleDateString('fr-FR')
          : '—';
        const opt = document.createElement('option');
        opt.value = 'template_' + t.id;  // préfixe pour distinguer
        opt.textContent = `📋 ${t.title || 'Modèle sans titre'} — sauvegardé le ${dateStr}`;
        groupModels.appendChild(opt);
      });
    }

    // === PARTIE 2 : Bilans déjà remplis (pathology_assessment_entries) ===
    const { data: entries, error: eError } = await db
      .from('pathology_assessment_entries')
      .select('id, title, assessment_date, patient_id')
      .eq('pathology_id', currentAssessmentPathologyId)
      .eq('practitioner_id', currentPractitioner.id)
      .order('assessment_date', { ascending: false })
      .limit(20);

    if(eError) throw eError;

    if(entries && entries.length){
      // Groupe optgroup pour les bilans remplis
      const groupEntries = document.createElement('optgroup');
      groupEntries.label = '── Bilans remplis (copier les valeurs) ──';
      sel.appendChild(groupEntries);

      entries.forEach(entry => {
        const patient = patients.find(p => p.id === entry.patient_id);
        const patientName = patient
          ? `${patient.first_name} ${patient.last_name}`
          : 'Patient inconnu';
        const dateStr = entry.assessment_date
          ? new Date(entry.assessment_date).toLocaleDateString('fr-FR')
          : '—';
        const opt = document.createElement('option');
        opt.value = 'entry_' + entry.id;  // préfixe pour distinguer
        opt.textContent = `📝 ${entry.title || 'Bilan'} — ${patientName} — ${dateStr}`;
        groupEntries.appendChild(opt);
      });
    }

    // Message si rien du tout
    if((!templates || !templates.length) && (!entries || !entries.length)){
      const opt = document.createElement('option');
      opt.disabled = true;
      opt.textContent = 'Aucun modèle ni bilan enregistré pour cette pathologie';
      sel.appendChild(opt);
    }

  } catch(e) {
    console.error('Erreur chargement sélecteur modèles:', e);
    showToast('Erreur chargement modèles : ' + e.message, 'red');
  }
}

async function loadSavedAssessmentAsTemplate(){
  const sel = document.getElementById('assessmentTemplateSelector');
  if(!sel || !sel.value) {
    renderAssessmentForm();
    showToast('Formulaire réinitialisé', 'blue');
    return;
  }

  const value = sel.value;

  try {
    // === CAS 1 : C'est un modèle de structure ===
    if(value.startsWith('template_')){
      const templateId = value.replace('template_', '');

      const { data, error } = await db
        .from('pathology_assessment_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if(error) throw error;
      if(!data){ showToast('Modèle introuvable', 'red'); return; }

      // Charge la structure du modèle
      assessmentTemplate = {
        id: data.id,
        title: data.title || 'Bilan de la pathologie',
        sections: Array.isArray(data.sections) ? data.sections : []
      };

      // Titre du nouveau bilan
      document.getElementById('assessmentTitle').value =
        data.title || 'Bilan';

      renderAssessmentTemplateBuilder();
      renderAssessmentForm();

      showToast('Structure du modèle chargée ✓', 'green');
    }

    // === CAS 2 : C'est un bilan rempli (copie des valeurs) ===
    else if(value.startsWith('entry_')){
      const entryId = value.replace('entry_', '');

      const { data, error } = await db
        .from('pathology_assessment_entries')
        .select('*')
        .eq('id', entryId)
        .single();

      if(error) throw error;
      if(!data){ showToast('Bilan introuvable', 'red'); return; }

      // Charge la structure snapshot si différente
      if(data.template_snapshot && data.template_snapshot.sections){
        assessmentTemplate = {
          id: assessmentTemplate.id,
          title: data.template_snapshot.title || assessmentTemplate.title,
          sections: data.template_snapshot.sections
        };
      }

      // Titre avec date du jour
      const dateStr = new Date().toLocaleDateString('fr-FR');
      document.getElementById('assessmentTitle').value =
        `${data.title || 'Bilan'} — copie du ${dateStr}`;

      renderAssessmentTemplateBuilder();
      renderAssessmentForm();

      // Pré-remplit les valeurs après rendu
      setTimeout(() => {
        const values = data.values || {};
        Object.entries(values).forEach(([fieldId, value]) => {
          const el = document.querySelector(`[data-assessment-field="${fieldId}"]`);
          if(el) el.value = value;
        });

        // Notes
        if(data.notes){
          document.getElementById('assessmentNotes').value = data.notes;
        }
      }, 150);

      showToast('Bilan copié — modifiez puis enregistrez ✓', 'green');
    }

  } catch(e) {
    console.error('Erreur chargement modèle/bilan:', e);
    showToast('Erreur : ' + e.message, 'red');
  }
}

// ===== SIDEBAR MOBILE =====
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('visible');
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.remove('open');
  overlay.classList.remove('visible');
}

// Affiche le burger sur mobile, ferme la sidebar en changeant de vue sur mobile
function initMobileUI() {
  loadSavedAccentColor();
  const burger = document.getElementById('burgerBtn');

  if (window.innerWidth <= 768) {
    if (burger) burger.style.display = 'flex';
  }
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      closeSidebar();
      if (burger) burger.style.display = 'none';
    } else {
      if (burger) burger.style.display = 'flex';
    }
  });
}

// Ferme la sidebar quand on clique sur un nav-item sur mobile
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    if (window.innerWidth <= 768) closeSidebar();
  });
});

// ============================================================
// MODÈLES DE QUESTIONNAIRES RED/YELLOW FLAGS
// ============================================================

let flagTemplatesCache = [];

async function loadFlagTemplates() {
  if (!currentPractitioner) return;

  const { data, error } = await db
    .from('flag_questionnaire_templates')
    .select('*')
    .eq('practitioner_id', currentPractitioner.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Erreur chargement modèles flags:', error);
    return;
  }

  flagTemplatesCache = data || [];
  populateFlagTemplateSelector();
}

function populateFlagTemplateSelector() {
  const sel = document.getElementById('flagTemplateSelector');
  if (!sel) return;

  sel.innerHTML = '<option value="">— Charger un modèle sauvegardé —</option>' +
    flagTemplatesCache.map(t => `
      <option value="${t.id}">
        ${escapeHTML(t.name)}
        ${t.description ? ` — ${escapeHTML(t.description)}` : ''}
      </option>
    `).join('');
}

function openSaveFlagTemplatePanel() {
  const panel = document.getElementById('saveFlagTemplatePanel');
  if (panel) panel.style.display = 'block';
  document.getElementById('flagTemplateName').focus();
}

async function saveFlagTemplate() {
  const name = document.getElementById('flagTemplateName').value.trim();
  if (!name) {
    showToast('Donnez un nom au modèle', 'red');
    return;
  }

  const desc = document.getElementById('flagTemplateDesc').value.trim();

  const cleaned = pathologyFlagsQuestions
    .map((q, i) => ({
      question: String(q.question || '').trim(),
      flag_type: q.flag_type === 'red' ? 'red' : 'yellow',
      is_active: q.is_active !== false,
      position: i + 1
    }))
    .filter(q => q.question.length > 0);

  if (!cleaned.length) {
    showToast('Ajoutez au moins une question avant de sauvegarder', 'red');
    return;
  }

  try {
    const { error } = await db
      .from('flag_questionnaire_templates')
      .insert({
        practitioner_id: currentPractitioner.id,
        name,
        description: desc,
        questions: cleaned
      });

    if (error) throw error;

    document.getElementById('flagTemplateName').value = '';
    document.getElementById('flagTemplateDesc').value = '';
    document.getElementById('saveFlagTemplatePanel').style.display = 'none';

    await loadFlagTemplates();
    showToast('Modèle sauvegardé !', 'green');

  } catch (e) {
    console.error('Erreur sauvegarde modèle flags:', e);
    showToast('Erreur : ' + e.message, 'red');
  }
}

async function loadFlagTemplate() {
  const sel = document.getElementById('flagTemplateSelector');
  if (!sel || !sel.value) {
    showToast('Sélectionnez un modèle à charger', 'red');
    return;
  }

  const template = flagTemplatesCache.find(t => t.id === sel.value);
  if (!template) {
    showToast('Modèle introuvable', 'red');
    return;
  }

  if (!confirm(`Charger le modèle "${template.name}" ? Les questions actuelles seront remplacées.`)) return;

  pathologyFlagsQuestions = (Array.isArray(template.questions) ? template.questions : [])
    .map((q, i) => ({
      question: q.question || '',
      flag_type: q.flag_type === 'red' ? 'red' : 'yellow',
      is_active: q.is_active !== false,
      position: i + 1
    }));

  renderPathologyFlagsBuilder();
  showToast(`Modèle "${template.name}" chargé`, 'green');
}

async function deleteSelectedFlagTemplate() {
  const sel = document.getElementById('flagTemplateSelector');
  if (!sel || !sel.value) {
    showToast('Sélectionnez un modèle à supprimer', 'red');
    return;
  }

  const template = flagTemplatesCache.find(t => t.id === sel.value);
  if (!template) return;

  if (!confirm(`Supprimer le modèle "${template.name}" ? Cette action est irréversible.`)) return;

  try {
    const { error } = await db
      .from('flag_questionnaire_templates')
      .delete()
      .eq('id', template.id)
      .eq('practitioner_id', currentPractitioner.id);

    if (error) throw error;

    await loadFlagTemplates();
    showToast('Modèle supprimé', 'green');

  } catch (e) {
    console.error('Erreur suppression modèle flags:', e);
    showToast('Erreur : ' + e.message, 'red');
  }
}
// ============================================================
// PERSONNALISATION COMPLÈTE DE L'INTERFACE
// ============================================================

const COLOR_THEMES = [
  {
    id: 'ocean',
    name: 'Océan',
    accent: '#3b82f6',
    sidebar: '#1e293b',
    preview: ['#1e293b','#3b82f6','#f0f4f8']
  },
  {
    id: 'forest',
    name: 'Forêt',
    accent: '#10b981',
    sidebar: '#064e3b',
    preview: ['#064e3b','#10b981','#f0fdf4']
  },
  {
    id: 'royal',
    name: 'Royal',
    accent: '#8b5cf6',
    sidebar: '#2e1065',
    preview: ['#2e1065','#8b5cf6','#faf5ff']
  },
  {
    id: 'ruby',
    name: 'Rubis',
    accent: '#ef4444',
    sidebar: '#1f0000',
    preview: ['#1f0000','#ef4444','#fff5f5']
  },
  {
    id: 'slate',
    name: 'Ardoise',
    accent: '#64748b',
    sidebar: '#0f172a',
    preview: ['#0f172a','#64748b','#f1f5f9']
  },
  {
    id: 'rose',
    name: 'Rose',
    accent: '#ec4899',
    sidebar: '#1f0a18',
    preview: ['#1f0a18','#ec4899','#fdf2f8']
  },
  {
    id: 'teal',
    name: 'Teal',
    accent: '#0d9488',
    sidebar: '#042f2e',
    preview: ['#042f2e','#0d9488','#f0fdfa']
  },
];

const BG_STYLES = [
  { id: 'default', name: 'Défaut',  color: '#f0f4f8' },
  { id: 'white',   name: 'Blanc',   color: '#ffffff' },
  { id: 'cool',    name: 'Bleu',    color: '#eff6ff' },
  { id: 'green',   name: 'Vert',    color: '#f0fdf4' },
  { id: 'purple',  name: 'Violet',  color: '#faf5ff' },
  { id: 'warm',    name: 'Chaud',   color: '#fefce8' },
  { id: 'gray',    name: 'Gris',    color: '#f1f5f9' },
];

const FONT_SIZES = [
  { id: 'small',  name: 'Petite',  size: '13px' },
  { id: 'normal', name: 'Normal',  size: '14px' },
  { id: 'large',  name: 'Grande',  size: '15px' },
  { id: 'xlarge', name: 'XL',      size: '16px' },
];

function renderAccentColorPicker() {
  renderColorThemePicker();
  renderBgStylePicker();
  renderFontSizePicker();
}

function renderColorThemePicker() {
  const box = document.getElementById('colorThemePicker');
  if (!box) return;

  const current = localStorage.getItem('colorTheme') || 'ocean';

  box.innerHTML = COLOR_THEMES.map(t => {
    const isActive = t.id === current;
    return `
      <button type="button"
        onclick="applyColorTheme('${t.id}')"
        style="
          border: 2px solid ${isActive ? t.accent : 'var(--border)'};
          border-radius: 12px;
          background: var(--card);
          padding: 10px;
          cursor: pointer;
          transition: all .2s;
          box-shadow: ${isActive ? `0 0 0 3px ${t.accent}44` : 'none'};
          position: relative;
        ">
        <!-- Mini preview sidebar + accent -->
        <div style="display:flex;gap:4px;margin-bottom:7px;border-radius:7px;overflow:hidden;height:30px">
          <div style="width:28%;background:${t.preview[0]};border-radius:5px 0 0 5px"></div>
          <div style="flex:1;background:${t.preview[2]};display:flex;align-items:center;justify-content:center">
            <div style="width:60%;height:6px;border-radius:3px;background:${t.preview[1]}"></div>
          </div>
        </div>
        <div style="font-size:11px;font-weight:700;color:var(--text);text-align:center">
          ${t.name}
        </div>
        ${isActive ? `
          <div style="
            position:absolute;top:5px;right:5px;
            width:16px;height:16px;
            background:${t.accent};
            border-radius:50%;
            display:flex;align-items:center;justify-content:center;
          ">
            <i class="fa-solid fa-check" style="color:#fff;font-size:8px"></i>
          </div>
        ` : ''}
      </button>
    `;
  }).join('');

  // Met à jour le label du thème actuel
  const label = document.getElementById('currentThemeLabel');
  if (label) {
    const theme = COLOR_THEMES.find(t => t.id === current) || COLOR_THEMES[0];
    label.textContent = theme.name;
    label.style.color = theme.accent;
  }
}

function renderBgStylePicker() {
  const box = document.getElementById('bgStylePicker');
  if (!box) return;

  const current = localStorage.getItem('bgStyle') || 'default';

  box.innerHTML = BG_STYLES.map(b => {
    const isActive = b.id === current;
    return `
      <button type="button"
        onclick="applyBgStyle('${b.id}')"
        title="${b.name}"
        style="
          display:flex;flex-direction:column;align-items:center;gap:4px;
          border:none;background:transparent;cursor:pointer;
        ">
        <div style="
          width:38px;height:38px;
          border-radius:10px;
          background:${b.color};
          border: 2px solid ${isActive ? 'var(--accent)' : 'var(--border)'};
          box-shadow: ${isActive ? '0 0 0 2px var(--accent)44' : 'none'};
          display:flex;align-items:center;justify-content:center;
          transition:all .2s;
        ">
          ${isActive ? `<i class="fa-solid fa-check" style="color:#1e293b;font-size:12px"></i>` : ''}
        </div>
        <span style="font-size:10px;color:var(--text3);font-weight:600">${b.name}</span>
      </button>
    `;
  }).join('');
}

function renderFontSizePicker() {
  const box = document.getElementById('fontSizePicker');
  if (!box) return;

  const current = localStorage.getItem('fontSize') || 'normal';

  box.innerHTML = FONT_SIZES.map(f => {
    const isActive = f.id === current;
    return `
      <button type="button"
        onclick="applyFontSize('${f.id}')"
        style="
          padding: 8px 16px;
          border-radius: 9px;
          border: 2px solid ${isActive ? 'var(--accent)' : 'var(--border)'};
          background: ${isActive ? 'var(--accent)' : 'var(--card)'};
          color: ${isActive ? '#fff' : 'var(--text2)'};
          font-size: ${f.size};
          font-weight: 700;
          cursor: pointer;
          transition: all .2s;
        ">
        ${f.name}
      </button>
    `;
  }).join('');
}

function applyColorTheme(themeId) {
  const theme = COLOR_THEMES.find(t => t.id === themeId);
  if (!theme) return;

  document.documentElement.setAttribute('data-color-theme', themeId);
  localStorage.setItem('colorTheme', themeId);

  renderColorThemePicker();
  showToast(`Thème "${theme.name}" appliqué !`, 'green');
}

function applyBgStyle(styleId) {
  if (styleId === 'default') {
    document.documentElement.removeAttribute('data-bg-style');
  } else {
    document.documentElement.setAttribute('data-bg-style', styleId);
  }
  localStorage.setItem('bgStyle', styleId);
  renderBgStylePicker();
  showToast('Fond appliqué !', 'green');
}

function applyFontSize(sizeId) {
  document.documentElement.setAttribute('data-font-size', sizeId);
  localStorage.setItem('fontSize', sizeId);
  renderFontSizePicker();
  showToast('Taille de police modifiée !', 'green');
}

function resetAllTheme() {
  applyColorTheme('ocean');
  applyBgStyle('default');
  applyFontSize('normal');
  localStorage.removeItem('colorTheme');
  localStorage.removeItem('bgStyle');
  localStorage.removeItem('fontSize');
  // Nettoie les anciens localStorage
  localStorage.removeItem('accentColor');
  localStorage.removeItem('bgColor');
  showToast('Thème réinitialisé', 'green');
}

// Alias pour compatibilité avec resetColors() si encore appelé ailleurs
function resetColors() { resetAllTheme(); }

function applyAccentColor() {} // vide pour compatibilité
function applyBgColor()    {} // vide pour compatibilité

function loadSavedAccentColor() {
  // Charge le thème complet
  const savedTheme = localStorage.getItem('colorTheme') || 'ocean';
  document.documentElement.setAttribute('data-color-theme', savedTheme);

  // Charge le style de fond
  const savedBg = localStorage.getItem('bgStyle') || 'default';
  if (savedBg !== 'default') {
    document.documentElement.setAttribute('data-bg-style', savedBg);
  }

  // Charge la taille de police
  const savedFont = localStorage.getItem('fontSize') || 'normal';
  document.documentElement.setAttribute('data-font-size', savedFont);
}

// ============================================================
// EXPORT RGPD
// ============================================================
async function exportAllDataRGPD(format = 'json') {
  if (!currentPractitioner) return;

  showToast('Préparation de l\'export...', 'blue');

  try {
    const pid = currentPractitioner.id;

    const { data: pats, error: patsError } = await db
      .from('patients')
      .select('*')
      .eq('practitioner_id', pid);

    if (patsError) throw patsError;

    const patientIds = (pats || []).map(p => p.id);

    const [
      { data: progs, error: progsError },
      { data: lib, error: libError },
      { data: sessions, error: sessionsError },
      { data: messages, error: messagesError },
      { data: pathos, error: pathosError }
    ] = await Promise.all([
      db.from('programs').select('*').eq('practitioner_id', pid),
      db.from('exercises_library').select('*').eq('practitioner_id', pid),
      patientIds.length
        ? db.from('sessions').select('*').in('patient_id', patientIds)
        : Promise.resolve({ data: [], error: null }),
      patientIds.length
        ? db.from('messages').select('*').in('patient_id', patientIds)
        : Promise.resolve({ data: [], error: null }),
      db.from('pathologies_library').select('*').eq('practitioner_id', pid)
    ]);

    if (progsError) throw progsError;
    if (libError) throw libError;
    if (sessionsError) throw sessionsError;
    if (messagesError) throw messagesError;
    if (pathosError) throw pathosError;

    const exportDate = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      const payload = {
        export_date: exportDate,
        practitioner: {
          id: currentPractitioner.id,
          email: currentPractitioner.email,
          first_name: currentPractitioner.first_name,
          last_name: currentPractitioner.last_name,
          speciality: currentPractitioner.speciality,
          cabinet: currentPractitioner.cabinet
        },
        patients: pats || [],
        programs: progs || [],
        exercises_library: lib || [],
        sessions: sessions || [],
        messages: messages || [],
        pathologies: pathos || []
      };

      const blob = new Blob(
        [JSON.stringify(payload, null, 2)],
        { type: 'application/json;charset=utf-8;' }
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `alyzio-export-rgpd-${exportDate}.json`;
      a.click();
      URL.revokeObjectURL(url);

    } else {
      const safeCSV = v => {
        const s = String(v ?? '');
        return '"' + s.replace(/"/g, '""') + '"';
      };

      const rows = [
        [
          'Prénom',
          'Nom',
          'Âge',
          'Pathologie',
          'Statut',
          'Début',
          'Email',
          'Téléphone',
          'Date séance',
          'EVA',
          'Borg',
          'Note'
        ]
      ];

      (pats || []).forEach(p => {
        const patSessions = (sessions || []).filter(s => s.patient_id === p.id);

        if (!patSessions.length) {
          rows.push([
            p.first_name,
            p.last_name,
            p.age || '',
            p.pathology || '',
            p.status || '',
            p.start_date || '',
            p.email || '',
            p.phone || '',
            '',
            '',
            '',
            ''
          ]);
        } else {
          patSessions.forEach(s => {
            rows.push([
              p.first_name,
              p.last_name,
              p.age || '',
              p.pathology || '',
              p.status || '',
              p.start_date || '',
              p.email || '',
              p.phone || '',
              new Date(s.created_at).toLocaleString('fr-FR'),
              s.eva ?? '',
              s.borg ?? '',
              s.note || ''
            ]);
          });
        }
      });

      const csv = rows.map(r => r.map(safeCSV).join(';')).join('\n');
      const blob = new Blob(['\uFEFF' + csv], {
        type: 'text/csv;charset=utf-8;'
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `alyzio-export-rgpd-${exportDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }

    showToast('Export téléchargé !', 'green');

  } catch (e) {
    console.error('Erreur export RGPD:', e);
    showToast('Erreur export : ' + e.message, 'red');
  }
}

// ============================================================
// CHANGEMENT DE MOT DE PASSE
// ============================================================
async function changePassword() {
  const newPwd = document.getElementById('settNewPwd').value;
  const confirmPwd = document.getElementById('settNewPwdConfirm').value;
  const msgEl = document.getElementById('pwdChangeMsg');

  // Reset
  msgEl.style.display = 'none';
  msgEl.textContent = '';

  if (newPwd.length < 8) {
    msgEl.style.display = 'block';
    msgEl.style.color = 'var(--red)';
    msgEl.textContent = '❌ Le mot de passe doit faire au moins 8 caractères.';
    return;
  }

  if (newPwd !== confirmPwd) {
    msgEl.style.display = 'block';
    msgEl.style.color = 'var(--red)';
    msgEl.textContent = '❌ Les deux mots de passe ne correspondent pas.';
    return;
  }

  const btn = event.currentTarget;
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="loading-spinner" style="border-top-color:#fff"></span> Mise à jour...';

  try {
    const { error } = await db.auth.updateUser({ password: newPwd });

    if (error) throw error;

    msgEl.style.display = 'block';
    msgEl.style.color = 'var(--green)';
    msgEl.textContent = '✅ Mot de passe mis à jour avec succès !';

    // Vide les champs
    document.getElementById('settNewPwd').value = '';
    document.getElementById('settNewPwdConfirm').value = '';

    showToast('Mot de passe modifié !', 'green');

  } catch (e) {
    msgEl.style.display = 'block';
    msgEl.style.color = 'var(--red)';
    msgEl.textContent = '❌ Erreur : ' + e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}
// ============================================================
// ÉDITEUR RICHE PATHO TIP
// ============================================================
function fmtTip(cmd) {
  const editor = document.getElementById('pathoTipEditor');
  if (!editor) return;
  editor.focus();
  document.execCommand(cmd, false, null);
}

function fmtTipInsert(html) {
  const editor = document.getElementById('pathoTipEditor');
  if (!editor) return;
  editor.focus();
  document.execCommand('insertHTML', false, html);
}

function getPathoTipValue() {
  const editor = document.getElementById('pathoTipEditor');
  return editor ? editor.innerHTML : '';
}

function setPathoTipValue(html) {
  const editor = document.getElementById('pathoTipEditor');
  if (editor) editor.innerHTML = html || '';
}

// ============================================================
// RECHERCHE PROGRAMMES
// ============================================================

function renderPrograms() {
  const searchEl = document.getElementById('programSearch');
  const phaseEl  = document.getElementById('programPhaseFilter');
  if (searchEl) searchEl.value = '';
  if (phaseEl)  phaseEl.value  = 'all';
  renderProgramsFiltered(programs);
}

function filterPrograms() {
  const q     = (document.getElementById('programSearch')?.value || '').toLowerCase().trim();
  const phase =  document.getElementById('programPhaseFilter')?.value || 'all';

  const filtered = programs.filter(prog => {
    const nameOk = !q || (prog.name || '').toLowerCase().includes(q);
    let phaseOk = true;
    if (phase === 'template') {
      phaseOk = prog.is_template === true || !prog.patient_id;
    } else if (phase !== 'all') {
      phaseOk = prog.phase === phase;
    }
    return nameOk && phaseOk;
  });

  renderProgramsFiltered(filtered);
}

function renderProgramsFiltered(list) {
  const g = document.getElementById('programsGrid');

  if (!list || !list.length) {
    g.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--text3);grid-column:1/-1">
        <i class="fa-solid fa-magnifying-glass"
           style="font-size:28px;margin-bottom:10px;display:block;opacity:.3"></i>
        Aucun programme trouvé.
      </div>`;
    return;
  }

  g.innerHTML = list.map(prog => {
    const pat = patients.find(x => x.id === prog.patient_id);
    const isTemplate = prog.is_template === true || !prog.patient_id;

    return `
      <div class="prog-card">
        <div class="prog-card-header">
          <div style="display:flex;align-items:flex-start;gap:10px;flex:1">
            <div class="prog-card-icon"
                 style="background:linear-gradient(135deg,#dbeafe,#bfdbfe)">
              ${isTemplate ? '📚' : '🏋️'}
            </div>
            <div>
              <div class="prog-title">${escapeHTML(prog.name)}</div>
              <div class="prog-sub">
                ${isTemplate
                  ? 'Modèle réutilisable'
                  : pat
                    ? `${escapeHTML(pat.first_name)} ${escapeHTML(pat.last_name)}`
                    : 'Non assigné'}
              </div>
            </div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-secondary btn-sm btn-icon-only"
                    onclick="openProgramBuilder('${prog.id}')">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn btn-danger btn-sm btn-icon-only"
                    onclick="deleteProgram('${prog.id}')">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
        <div class="prog-card-body">
          <div style="font-size:12px;color:var(--text3)">
            ${(prog.exercises || []).length} exercice(s) · ${escapeHTML(prog.frequency || '—')}
          </div>
        </div>
        <div class="prog-card-footer">
          <span class="badge ${isTemplate ? 'badge-purple' : 'badge-blue'}"
            style="${isTemplate ? 'background:rgba(139,92,246,.15);color:#7c3aed' : ''}">
            ${isTemplate ? 'Modèle' : escapeHTML(phaseLabel(prog.phase))}
          </span>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// RECHERCHE PROMs
// ============================================================

async function filterPromList() {
  const q = (document.getElementById('promSearch')?.value || '').toLowerCase().trim();
  const filtered = promsCache.filter(p =>
    !q || (p.title || '').toLowerCase().includes(q)
  );
  renderPromListFiltered(filtered);
}

function renderPromListFiltered(list) {
  const box = document.getElementById('promList');
  if (!box) return;

  if (!list.length) {
    box.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--text3);font-size:13px">
        <i class="fa-solid fa-magnifying-glass"
           style="font-size:28px;margin-bottom:10px;display:block;opacity:.3"></i>
        Aucun questionnaire trouvé.
      </div>`;
    return;
  }

  const scoreModeLabel = {
    sum:     'Somme',
    average: 'Moyenne',
    percent: 'Pourcentage'
  };

  box.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Titre</th>
          <th>Questions</th>
          <th>Calcul</th>
          <th>Créé le</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(p => {
          let questions = [];
          try { questions = JSON.parse(p.questions || '[]'); } catch(e) {}
          return `
            <tr>
              <td>
                <div style="font-weight:700;color:var(--text)">${escapeHTML(p.title)}</div>
                ${p.description
                  ? `<div style="font-size:11px;color:var(--text3)">
                      ${escapeHTML(p.description.slice(0,60))}${p.description.length>60?'…':''}
                     </div>`
                  : ''}
              </td>
              <td><span class="badge badge-blue">${questions.length} q.</span></td>
              <td><span class="badge badge-gray">${scoreModeLabel[p.score_mode] || 'Somme'}</span></td>
              <td style="font-size:11px;color:var(--text3)">
                ${new Date(p.created_at).toLocaleDateString('fr-FR')}
              </td>
              <td>
                <div style="display:flex;gap:6px">
                  <button class="btn btn-secondary btn-sm btn-icon-only"
                          onclick="editProm('${p.id}')" title="Modifier">
                    <i class="fa-solid fa-pen"></i>
                  </button>
                  <button class="btn btn-danger btn-sm btn-icon-only"
                          onclick="deleteProm('${p.id}')" title="Supprimer">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// ============================================================
// RECHERCHE MODÈLE PROGRAMME dans le builder
// ============================================================

function filterModelSelector() {
  const q = (document.getElementById('modelSearch')?.value || '').toLowerCase().trim();
  const sel = document.getElementById('modelSelector');
  if (!sel) return;

  const models = programs.filter(p => p.is_template === true || !p.patient_id);

  const filtered = models.filter(m =>
    !q ||
    (m.name || '').toLowerCase().includes(q) ||
    (m.phase || '').toLowerCase().includes(q) ||
    (m.description || '').toLowerCase().includes(q)
  );

  sel.innerHTML = '<option value="">-- Sélectionner un modèle --</option>' +
    filtered.map(m => {
      const pat = patients.find(x => x.id === m.patient_id);
      const label = pat
        ? `${m.name} — ${pat.first_name} ${pat.last_name}`
        : m.name;
      return `<option value="${m.id}">${escapeHTML(label)} (${escapeHTML(phaseLabel(m.phase))})</option>`;
    }).join('');
}

// ============================================================
// RECHERCHE PROM dans le sélecteur du programme
// ============================================================

function filterPromPicker() {
  const q = (document.getElementById('promPickerSearch')?.value || '').toLowerCase().trim();
  const resultsBox = document.getElementById('promPickerResults');
  if (!resultsBox) return;

  if (!q) {
    resultsBox.style.display = 'none';
    resultsBox.innerHTML = '';
    return;
  }

  const filtered = availableProms.filter(p =>
    (p.title || '').toLowerCase().includes(q)
  );

  if (!filtered.length) {
    resultsBox.style.display = 'block';
    resultsBox.innerHTML = `
      <div style="padding:12px;text-align:center;color:var(--text3);font-size:12px">
        Aucun questionnaire trouvé
      </div>`;
    return;
  }

  resultsBox.style.display = 'block';
  resultsBox.innerHTML = filtered.map(p => `
    <div onclick="addPromFromPicker('${p.id}','${escapeHTML(p.title)}')"
         style="
           padding:10px 14px;
           cursor:pointer;
           border-bottom:1px solid var(--border);
           font-size:13px;
           display:flex;
           align-items:center;
           gap:8px;
           transition:background .15s;
         "
         onmouseover="this.style.background='var(--bg)'"
         onmouseout="this.style.background=''">
      <i class="fa-solid fa-file-signature"
         style="color:var(--accent);font-size:12px"></i>
      <span style="font-weight:600;color:var(--text)">${escapeHTML(p.title)}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--accent);font-weight:700">
        + Ajouter
      </span>
    </div>
  `).join('');
}

function addPromFromPicker(promId, promTitle) {
  const existing = getSelectedPromIds();

  if (existing.includes(promId)) {
    showToast('Ce questionnaire est déjà ajouté', 'blue');
    return;
  }

  renderProgPromsContainer([...existing, promId]);

  const searchEl = document.getElementById('promPickerSearch');
  const resultsEl = document.getElementById('promPickerResults');
  if (searchEl) searchEl.value = '';
  if (resultsEl) {
    resultsEl.style.display = 'none';
    resultsEl.innerHTML = '';
  }

  showToast(`"${promTitle}" ajouté`, 'green');
}

function showView(v){
  closeSidebar();

  document.querySelectorAll('.view').forEach(el => {
    el.classList.remove('active');
  });

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.remove('active');
  });

  const view = document.getElementById('view-' + v);
  const nav  = document.getElementById('nav-' + v);

  if (!view) {
    console.error('[showView] Vue introuvable:', 'view-' + v);
    return;
  }

  view.classList.add('active');
  if (nav) nav.classList.add('active');

  const titles = {
    dashboard:    'Tableau de bord',
    patients:     'Patients',
    programs:     'Programmes',
    library:      'Bibliothèque d\'exercices',
    'patho-lib':  'Bibliothèque de pathologies',
    proms:        'Questionnaires (PROMs)',
    settings:     'Paramètres'
  };

  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = titles[v] || '';

  if (v === 'library')    renderLibrary();
  if (v === 'patho-lib')  renderPathos();
  if (v === 'proms')      loadPromList();
  if (v === 'settings')   renderAccentColorPicker();
}

tryAutoLogin();