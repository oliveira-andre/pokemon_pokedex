// DOM references used across rendering, controls, and PWA splash behavior.
const pokedexName = document.querySelector('.pokedex-name');
const pokedexNumber = document.querySelector('.pokedex-number');
const pokedexSeparator = document.querySelector('.pokedex-separator');
const pokedexImage = document.querySelector('.pokedex-image');
const pokedexForm = document.querySelector('.pokedex-form');
const pokedexInput = document.querySelector('.pokedex-search-input');
const pokedexLeftPanel = document.querySelector('.pokedex-left-panel');
const pokedexPrevButton = document.querySelector('.pokedex-button-prev');
const pokedexNextButton = document.querySelector('.pokedex-button-next');
const pokedexLanguageButtons = document.querySelectorAll('.pokedex-toggle[data-language]');
const pokedexRightSubtitle = document.querySelector('.pokedex-right-subtitle');
const pokedexTranscriptDisplay = document.querySelector('.pokedex-transcript-display');
const pokedexSplash = document.querySelector('#pokedex-pwa-splash');

// Quiz Mode DOM references.
const pokedexModeToggle = document.querySelector('#pokedex-mode-toggle');
const modeTextQuiz = document.querySelector('.mode-text-quiz');
const modeTextNormal = document.querySelector('.mode-text-normal');
const pokedexScoreBar = document.querySelector('.pokedex-score-bar');
const scoreSuccessEl = document.querySelector('#score-success');
const scoreFailureEl = document.querySelector('#score-failure');
const scoreCurrentEl = document.querySelector('#score-current');
const pokedexFeedback = document.querySelector('#pokedex-feedback');
const pokedexSubmitButton = document.querySelector('.pokedex-button-submit');
const pokedexResetButton = document.querySelector('#pokedex-reset');
const summaryOverlay = document.querySelector('#pokedex-summary');
const summarySuccessEl = document.querySelector('#summary-success');
const summaryFailureEl = document.querySelector('#summary-failure');
const summaryListEl = document.querySelector('#summary-list');
const summaryCloseButton = document.querySelector('#summary-close');
const pokedexSummaryTitle = document.querySelector('.pokedex-summary-title');

// Core data sources.
// `LOCAL_KANTO_DATA_URL` is an optional local mirror for the first generation.
// If local data is missing/incomplete, the API flow still works as fallback.
const POKE_API_BASE_URL = 'https://pokeapi.co/api/v2/pokemon/';
const LOCAL_KANTO_DATA_URL = './data/kanto-151.json';
const LOCAL_KANTO_LIMIT = 151;

// UI translations in portuguese and english.
const translations = {
  en: {
    prev: 'Prev <',
    next: 'Next >',
    placeholder: 'Name or Number',
    loading: 'Loading...',
    notFound: 'Not found :c',
    rightSubtitle: 'Navigate with buttons or keyboard arrows.',
    documentLanguage: 'en',
    quizPlaceholder: "Who's that Pokémon?",
    quizComplete: 'Quiz Complete!',
    viewResults: 'View Results',
    close: '✕ Close',
    resetConfirm: 'Reset all progress? This will clear all your answers.',
    correct: 'Correct!',
    submit: 'Submit',
    quizMode: 'Quiz Mode',
    normalMode: 'Normal Mode',
    perfectRun: 'Perfect run! No wrong answers.',
    emptyGuess: '(no answer)'
  },
  pt: {
    prev: 'Anterior <',
    next: 'Próximo >',
    placeholder: 'Nome ou Número',
    loading: 'Carregando...',
    notFound: 'Não encontrado :c',
    rightSubtitle: 'Navegue pelos botões ou setas do teclado.',
    documentLanguage: 'pt-BR',
    quizPlaceholder: 'Quem é esse Pokémon?',
    quizComplete: 'Quiz Completo!',
    viewResults: 'Ver Resultados',
    close: '✕ Fechar',
    resetConfirm: 'Zerar progresso? Isso vai apagar todas as respostas.',
    correct: 'Correto!',
    submit: 'Enviar',
    quizMode: 'Modo Quiz',
    normalMode: 'Modo Normal',
    perfectRun: 'Perfeito! Nenhuma resposta errada.',
    emptyGuess: '(sem resposta)'
  }
};

// Runtime state shared across async operations and UI updates.
const pokemonCache = new Map();
const localKantoById = new Map();
const localKantoByName = new Map();
const pokedexAudio = new Audio();

let currentPokemonId = 1;
let maxPokemonId = 1025;
let latestRenderRequest = 0;
let currentLanguage = 'pt';
let isRendering = false;
let hasTriedLoadingLocalKantoData = false;
let captionAnimationFrame = null;
let currentCaptionIndex = -1;
let latestAudioRequest = 0;

// Quiz Mode state.
const TOTAL_POKEMON = 151;
const QUIZ_STORAGE_KEY = 'pokemon-score-state';
const QUIZ_FEEDBACK_DURATION_MS = 1400;

let isQuizMode = false;
let kantoList = [];
let quizIndex = 0;
let successCount = 0;
let failureCount = 0;
let answers = {};
let isQuizProcessing = false;

// Reuse one audio element to avoid creating multiple players.
pokedexAudio.preload = 'none';

const setAudioPlaybackState = (isPlaying) => {
  pokedexLeftPanel?.classList.toggle('pokedex-audio-playing', isPlaying);
};

const setTranscriptText = (text = '') => {
  if (pokedexTranscriptDisplay) {
    pokedexTranscriptDisplay.textContent = text;
  }
};

const getTranslation = (key) => translations[currentLanguage][key] || '';
const normalizePokemonQuery = (value) => String(value).trim().toLowerCase();

const parseSrtTimestamp = (timestamp) => {
  const [, hours, minutes, seconds, milliseconds] = timestamp.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/) || [];
  if (!hours) {
    return 0;
  }

  return (Number(hours) * 3600) + (Number(minutes) * 60) + Number(seconds) + (Number(milliseconds) / 1000);
};

const parseSrt = (srtText) => srtText
  .trim()
  .split(/\n\s*\n/)
  .map((block) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const timingLine = lines.find((line) => line.includes('-->'));
    if (!timingLine) {
      return null;
    }

    const [start, end] = timingLine.split('-->').map((value) => value.trim());
    const text = lines.slice(lines.indexOf(timingLine) + 1).join(' ');
    return {
      start: parseSrtTimestamp(start),
      end: parseSrtTimestamp(end),
      text
    };
  })
  .filter((cue) => cue?.text);

const fetchTranscriptCues = async (transcriptPath) => {
  try {
    const response = await fetch(transcriptPath);
    if (!response.ok) {
      return [];
    }

    return parseSrt(await response.text());
  } catch {
    return [];
  }
};

const audioFileExists = async (audioPath) => {
  try {
    const response = await fetch(audioPath, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
};

const stopTranscriptSync = ({ clearText = true } = {}) => {
  if (captionAnimationFrame !== null) {
    cancelAnimationFrame(captionAnimationFrame);
    captionAnimationFrame = null;
  }

  currentCaptionIndex = -1;
  setAudioPlaybackState(false);

  if (clearText) {
    setTranscriptText();
  }
};

const startTranscriptSync = (cues, audioRequestId) => {
  stopTranscriptSync({ clearText: true });

  if (!cues.length) {
    return;
  }

  const syncCaption = () => {
    if (audioRequestId !== latestAudioRequest || pokedexAudio.paused || pokedexAudio.ended) {
      stopTranscriptSync({ clearText: pokedexAudio.ended || audioRequestId !== latestAudioRequest });
      return;
    }

    const currentTime = pokedexAudio.currentTime;
    const nextCaptionIndex = cues.findIndex((cue) => currentTime >= cue.start && currentTime <= cue.end);
    const activeCue = nextCaptionIndex >= 0 ? cues[nextCaptionIndex] : null;

    setAudioPlaybackState(Boolean(activeCue));

    if (nextCaptionIndex !== currentCaptionIndex) {
      currentCaptionIndex = nextCaptionIndex;
      setTranscriptText(activeCue?.text || '');
    }

    captionAnimationFrame = requestAnimationFrame(syncCaption);
  };

  captionAnimationFrame = requestAnimationFrame(syncCaption);
};

// Converts user input to a valid Pokemon ID when possible.
// Returns null for names, invalid numbers, decimals, and values < 1.
const parsePokemonId = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
};

const cachePokemon = (pokemon) => {
  // Store by both ID and name to make repeated searches/navigation instant.
  pokemonCache.set(pokemon.id, pokemon);
  pokemonCache.set(pokemon.name, pokemon);
};

// Unified data shape used by the UI layer.
const toPokemonModel = ({ id, name, sprite }) => ({
  id,
  name,
  sprite
});

const extractApiSprite = (pokemonData) => {
  // Keep sprite selection order stable for consistent quality.
  const animatedSprite = pokemonData?.sprites?.versions?.['generation-v']?.['black-white']?.animated?.front_default;
  const officialArtwork = pokemonData?.sprites?.other?.['official-artwork']?.front_default;
  const fallbackSprite = pokemonData?.sprites?.front_default;

  return animatedSprite || officialArtwork || fallbackSprite || '';
};

const fetchPokemonFromApi = async (pokemonQuery) => {
  // Single resource fetch used as canonical fallback and source for >151.
  const response = await fetch(`${POKE_API_BASE_URL}${pokemonQuery}`);
  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const pokemon = toPokemonModel({
    id: data.id,
    name: data.name,
    sprite: extractApiSprite(data)
  });

  cachePokemon(pokemon);
  return pokemon;
};

const getLocalKantoPokemon = (pokemonQuery) => {
  // Supports local lookup by ID ("25") and name ("pikachu").
  const idQuery = parsePokemonId(pokemonQuery);
  if (idQuery !== null) {
    return localKantoById.get(idQuery) || null;
  }

  return localKantoByName.get(normalizePokemonQuery(pokemonQuery)) || null;
};

const loadLocalKantoData = async () => {
  // Load once; if file is missing we silently continue with API-only behavior.
  if (hasTriedLoadingLocalKantoData) {
    return;
  }

  hasTriedLoadingLocalKantoData = true;

  try {
    const response = await fetch(LOCAL_KANTO_DATA_URL);
    if (!response.ok) {
      return;
    }

    const localData = await response.json();
    const pokemonList = Array.isArray(localData?.pokemon) ? localData.pokemon : [];

    // Validate each entry defensively so a malformed item does not break load.
    for (const entry of pokemonList) {
      const id = parsePokemonId(entry?.id);
      const name = normalizePokemonQuery(entry?.name || '');
      const sprite = typeof entry?.sprite === 'string' ? entry.sprite : '';

      if (!id || !name || !sprite) {
        continue;
      }

      const pokemon = toPokemonModel({ id, name, sprite });
      localKantoById.set(id, pokemon);
      localKantoByName.set(name, pokemon);
      cachePokemon(pokemon);
    }
  } catch {
    // Local JSON is optional. Network/API path will continue working.
  }
};

const fetchPokemon = async (pokemonQuery) => {
  // Keep query normalized so cache keys are consistent across inputs.
  const query = typeof pokemonQuery === 'number' ? pokemonQuery : normalizePokemonQuery(pokemonQuery);

  if (pokemonCache.has(query)) {
    return pokemonCache.get(query);
  }

  // Strategy:
  // 1) For IDs <= 151 (or name queries), attempt local JSON first.
  // 2) If not found locally, fallback to PokéAPI.
  // 3) IDs > 151 go straight to API.
  const idQuery = parsePokemonId(query);
  const shouldTryLocal = idQuery === null || idQuery <= LOCAL_KANTO_LIMIT;

  if (shouldTryLocal) {
    await loadLocalKantoData();
    const localPokemon = getLocalKantoPokemon(query);
    if (localPokemon) {
      return localPokemon;
    }
  }

  return fetchPokemonFromApi(query);
};

const initializePokemonLimit = async () => {
  // API count keeps navigation compatible when PokéAPI expands its catalog.
  try {
    const response = await fetch(`${POKE_API_BASE_URL}?limit=1`);
    if (!response.ok) {
      return;
    }

    const apiData = await response.json();
    if (Number.isInteger(apiData?.count) && apiData.count > 0) {
      maxPokemonId = apiData.count;
    }
  } catch {
    // Keep default max when API metadata request fails.
  }
};

const stopPokemonAudio = () => {
  // Reset source and playback position before trying next candidate audio.
  latestAudioRequest += 1;
  stopTranscriptSync();
  pokedexAudio.pause();
  pokedexAudio.currentTime = 0;
  pokedexAudio.removeAttribute('src');
  pokedexAudio.load();
};

const playPokemonAudio = async (pokemonId) => {
  // Audio fallback order is language-aware:
  // current-language specific -> current-language default -> other-language specific -> other-language default.
  const audioRequestId = ++latestAudioRequest;
  const primaryAudioFolder = currentLanguage === 'pt' ? 'ptbr' : 'en';
  const fallbackAudioFolder = primaryAudioFolder === 'ptbr' ? 'en' : 'ptbr';

  const audioCandidates = [
    { audioPath: `./audios/${primaryAudioFolder}/${pokemonId}.mp3`, transcriptPath: `./transcripts/${primaryAudioFolder}/${pokemonId}.srt` },
    { audioPath: `./audios/${primaryAudioFolder}/default-${primaryAudioFolder}.mp3`, transcriptPath: `./transcripts/${primaryAudioFolder}/default-${primaryAudioFolder}.srt` },
    { audioPath: `./audios/${fallbackAudioFolder}/${pokemonId}.mp3`, transcriptPath: `./transcripts/${fallbackAudioFolder}/${pokemonId}.srt` },
    { audioPath: `./audios/${fallbackAudioFolder}/default-${fallbackAudioFolder}.mp3`, transcriptPath: `./transcripts/${fallbackAudioFolder}/default-${fallbackAudioFolder}.srt` }
  ];

  stopTranscriptSync();

  for (const { audioPath, transcriptPath } of audioCandidates) {
    try {
      if (audioRequestId !== latestAudioRequest) {
        return;
      }

      if (!(await audioFileExists(audioPath))) {
        continue;
      }

      if (pokedexAudio.getAttribute('src') !== audioPath) {
        pokedexAudio.src = audioPath;
      }
      await pokedexAudio.play();

      if (audioRequestId !== latestAudioRequest) {
        return;
      }

      const transcriptCues = await fetchTranscriptCues(transcriptPath);
      startTranscriptSync(transcriptCues, audioRequestId);
      return;
    } catch {
      if (audioRequestId === latestAudioRequest) {
        stopTranscriptSync();
      }
      // Continue trying candidates until one succeeds.
    }
  }

  if (audioRequestId === latestAudioRequest) {
    stopPokemonAudio();
  }
};

const setLoadingState = () => {
  pokedexName.textContent = getTranslation('loading');
  pokedexNumber.textContent = '';
};

const setNotFoundState = () => {
  pokedexImage.style.display = 'none';
  pokedexName.textContent = getTranslation('notFound');
  pokedexNumber.textContent = '';
  stopPokemonAudio();
};

const setPokemonState = (pokemon) => {
  // Rendering is driven by the normalized model, independent from data source (local/API).
  if (!pokemon?.sprite) {
    setNotFoundState();
    return;
  }

  pokedexImage.style.display = 'block';
  pokedexName.textContent = pokemon.name;
  pokedexNumber.textContent = String(pokemon.id);
  pokedexImage.src = pokemon.sprite;
  pokedexInput.value = '';
  currentPokemonId = pokemon.id;

  playPokemonAudio(currentPokemonId);
};

const updateNavigationState = () => {
  // Disable buttons while fetching to avoid racey multi-click navigation.
  pokedexPrevButton.disabled = isRendering || currentPokemonId <= 1;
  pokedexNextButton.disabled = isRendering || currentPokemonId >= maxPokemonId;
};

const applyLanguage = (language) => {
  // Updates visible labels and accessibility state for language toggle buttons.
  currentLanguage = language;

  pokedexPrevButton.textContent = getTranslation('prev');
  pokedexNextButton.textContent = getTranslation('next');
  pokedexInput.placeholder = getTranslation(isQuizMode ? 'quizPlaceholder' : 'placeholder');

  if (pokedexRightSubtitle) {
    pokedexRightSubtitle.textContent = getTranslation('rightSubtitle');
  }

  document.documentElement.lang = getTranslation('documentLanguage');
  document.body.classList.toggle('pokedex-language-pt', currentLanguage === 'pt');

  for (const button of pokedexLanguageButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.language === currentLanguage));
  }

  applyQuizLanguage();

  // Reapply audio language immediately for the currently visible Pokemon.
  if (!isQuizMode && !isRendering && pokedexNumber.textContent) {
    playPokemonAudio(currentPokemonId);
  }
};

const renderPokemon = async (pokemonQuery) => {
  // Request token protects UI against out-of-order async responses.
  // Only the latest request is allowed to mutate the interface.
  const requestId = ++latestRenderRequest;
  isRendering = true;
  updateNavigationState();
  setLoadingState();

  try {
    const pokemon = await fetchPokemon(pokemonQuery);

    // Ignore stale responses triggered by older requests.
    if (requestId !== latestRenderRequest) {
      return;
    }

    if (!pokemon) {
      setNotFoundState();
      return;
    }

    setPokemonState(pokemon);
  } catch {
    setNotFoundState();
  } finally {
    if (requestId === latestRenderRequest) {
      isRendering = false;
      updateNavigationState();
    }
  }
};

const animateButtonClick = (button) => {
  button.classList.add('pokedex-button-click');
  window.setTimeout(() => {
    button.classList.remove('pokedex-button-click');
  }, 120);
};

const navigateToAdjacentPokemon = (direction, triggerButton) => {
  // Direction is expected as -1 (prev) or +1 (next).
  if (isRendering) {
    return;
  }

  const nextPokemonId = currentPokemonId + direction;
  if (nextPokemonId < 1 || nextPokemonId > maxPokemonId) {
    return;
  }

  if (triggerButton) {
    animateButtonClick(triggerButton);
  }

  currentPokemonId = nextPokemonId;
  renderPokemon(currentPokemonId);
};

// Search submit handler.
pokedexForm.addEventListener('submit', (event) => {
  event.preventDefault();

  if (isQuizMode) {
    handleQuizSubmit();
    return;
  }

  const query = normalizePokemonQuery(pokedexInput.value);
  if (!query) {
    return;
  }

  renderPokemon(query);
});

// Button navigation handlers.
pokedexPrevButton.addEventListener('click', () => {
  navigateToAdjacentPokemon(-1, pokedexPrevButton);
});

pokedexNextButton.addEventListener('click', () => {
  navigateToAdjacentPokemon(1, pokedexNextButton);
});

// Language toggle handlers.
for (const languageButton of pokedexLanguageButtons) {
  languageButton.addEventListener('click', () => {
    const nextLanguage = languageButton.dataset.language;
    if (!nextLanguage || nextLanguage === currentLanguage) {
      return;
    }

    applyLanguage(nextLanguage);
  });
}

// Keep captions and the PNG light overlay synchronized with transcript timing.
pokedexAudio.addEventListener('pause', () => stopTranscriptSync({ clearText: false }));
pokedexAudio.addEventListener('ended', () => stopTranscriptSync());
pokedexAudio.addEventListener('emptied', () => stopTranscriptSync());
pokedexAudio.addEventListener('error', () => stopTranscriptSync());

// Keyboard navigation handler (when not typing in search input).
document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) {
    return;
  }

  if (event.key === 'ArrowLeft') {
    navigateToAdjacentPokemon(-1, pokedexPrevButton);
  } else if (event.key === 'ArrowRight') {
    navigateToAdjacentPokemon(1, pokedexNextButton);
  }
});

const initializeApp = async () => {
  // Boot order:
  // 1) Apply default language.
  // 2) Warm local Kanto data.
  // 3) Fetch max available Pokemon count from API.
  // 4) Render initial Pokemon and hide splash.
  applyLanguage('pt');
  updateNavigationState();

  // Load local 1..151 dataset first (optional), then API max count.
  await loadLocalKantoData();
  await loadKantoQuizList();
  await initializePokemonLimit();
  updateNavigationState();

  loadQuizState();

  await renderPokemon(currentPokemonId);

  if (pokedexSplash) {
    window.setTimeout(() => {
      pokedexSplash.classList.add('pokedex-pwa-splash-hidden');
    }, 180);
  }
};

// ──────────────────────────────────────────────
// QUIZ MODE LOGIC
// ──────────────────────────────────────────────

const QUIZ_LIGHT_CLASSES = ['pokedex-quiz-light-success', 'pokedex-quiz-light-failure'];
const QUIZ_PANEL_CLASSES = ['pokedex-panel-success', 'pokedex-panel-failure'];

const levenshteinDistance = (a, b) => {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prevRow = Array.from({ length: n + 1 }, (_, i) => i);
  let currRow = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,
        currRow[j - 1] + 1,
        prevRow[j - 1] + cost
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }
  return prevRow[n];
};

// One-character typo tolerance keeps fast typing usable without giving away the answer.
const isCloseEnough = (guess, actual) => {
  const normalizedGuess = guess.trim().toLowerCase();
  const normalizedActual = actual.trim().toLowerCase();
  if (normalizedGuess === '') return false;
  if (normalizedGuess === normalizedActual) return true;
  return levenshteinDistance(normalizedGuess, normalizedActual) <= 1;
};

const loadKantoQuizList = async () => {
  // Reuse local Kanto data already loaded by loadLocalKantoData().
  kantoList = Array.from(localKantoById.values())
    .filter((entry) => entry.id >= 1 && entry.id <= TOTAL_POKEMON && entry.name && entry.sprite)
    .sort((a, b) => a.id - b.id);
};

const saveQuizState = () => {
  try {
    const state = { quizIndex, successCount, failureCount, answers };
    localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be disabled; quiz still works in-memory.
  }
};

const loadQuizState = () => {
  try {
    const raw = localStorage.getItem(QUIZ_STORAGE_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    if (typeof state.quizIndex === 'number' && typeof state.successCount === 'number') {
      quizIndex = state.quizIndex;
      successCount = state.successCount;
      failureCount = state.failureCount;
      answers = state.answers || {};
      return true;
    }
  } catch {
    // Ignore malformed state.
  }
  return false;
};

const updateScoreDisplay = ({ bumpSuccess = false, bumpFailure = false } = {}) => {
  if (scoreSuccessEl) scoreSuccessEl.textContent = successCount;
  if (scoreFailureEl) scoreFailureEl.textContent = failureCount;
  if (scoreCurrentEl) scoreCurrentEl.textContent = successCount + failureCount;

  // Score-pop animation runs by toggling a class on the relevant counter.
  const bump = (element) => {
    if (!element) return;
    element.classList.remove('pokedex-score-bump');
    void element.offsetWidth;
    element.classList.add('pokedex-score-bump');
  };
  if (bumpSuccess) bump(scoreSuccessEl);
  if (bumpFailure) bump(scoreFailureEl);
};

const applyQuizLanguage = () => {
  if (modeTextQuiz) modeTextQuiz.textContent = getTranslation('quizMode');
  if (modeTextNormal) modeTextNormal.textContent = getTranslation('normalMode');
  if (pokedexSummaryTitle) pokedexSummaryTitle.textContent = getTranslation('quizComplete');
  if (summaryCloseButton) summaryCloseButton.textContent = getTranslation('close');
  if (pokedexSubmitButton) {
    const showResults = isQuizMode && quizIndex >= kantoList.length && kantoList.length > 0;
    pokedexSubmitButton.textContent = getTranslation(showResults ? 'viewResults' : 'submit');
  }
};

const clearQuizFeedbackEffects = () => {
  pokedexLeftPanel.classList.remove(...QUIZ_PANEL_CLASSES, ...QUIZ_LIGHT_CLASSES);
};

const renderQuizPokemon = () => {
  if (quizIndex >= kantoList.length) {
    showSummary();
    return;
  }
  const pokemon = kantoList[quizIndex];
  pokedexImage.style.display = 'block';
  pokedexImage.src = pokemon.sprite;
  pokedexNumber.textContent = `#${String(pokemon.id).padStart(3, '0')}`;
  if (pokedexSeparator) pokedexSeparator.textContent = '';
  pokedexName.textContent = '';
  pokedexInput.value = '';
  pokedexInput.disabled = false;
  pokedexSubmitButton.disabled = false;
  pokedexFeedback.textContent = '';
  pokedexFeedback.style.display = 'none';
  pokedexFeedback.className = 'pokedex-feedback';
  pokedexInput.focus();
  updateScoreDisplay();
  applyQuizLanguage();
};

const showFeedback = (isCorrect, correctName) => {
  pokedexFeedback.style.display = 'block';
  pokedexFeedback.textContent = isCorrect
    ? `✔ ${getTranslation('correct')}`
    : `✖ ${correctName}`;
  pokedexFeedback.className = `pokedex-feedback ${isCorrect ? 'pokedex-feedback-success' : 'pokedex-feedback-failure'} pokedex-feedback-animate`;

  pokedexName.textContent = correctName;
  if (pokedexSeparator) pokedexSeparator.textContent = '-';

  // Restart panel + audio-light animations cleanly between successive answers.
  pokedexLeftPanel.classList.remove(...QUIZ_PANEL_CLASSES, ...QUIZ_LIGHT_CLASSES);
  void pokedexLeftPanel.offsetWidth;
  pokedexLeftPanel.classList.add(
    isCorrect ? 'pokedex-panel-success' : 'pokedex-panel-failure',
    isCorrect ? 'pokedex-quiz-light-success' : 'pokedex-quiz-light-failure'
  );
};

const showSummary = () => {
  if (summarySuccessEl) summarySuccessEl.textContent = successCount;
  if (summaryFailureEl) summaryFailureEl.textContent = failureCount;
  if (summaryListEl) {
    summaryListEl.innerHTML = '';
    const wrongEntries = kantoList.filter((pokemon) => !answers[pokemon.id]?.correct);
    if (wrongEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pokedex-summary-empty';
      empty.textContent = getTranslation('perfectRun');
      summaryListEl.appendChild(empty);
    } else {
      for (const pokemon of wrongEntries) {
        const answer = answers[pokemon.id];
        const item = document.createElement('div');
        item.className = 'pokedex-summary-item pokedex-summary-wrong';
        const sprite = document.createElement('img');
        sprite.src = pokemon.sprite;
        sprite.alt = pokemon.name;
        sprite.className = 'pokedex-summary-sprite';
        const info = document.createElement('div');
        info.className = 'pokedex-summary-info';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'pokedex-summary-name';
        nameSpan.textContent = `#${String(pokemon.id).padStart(3, '0')} ${pokemon.name}`;
        const guessSpan = document.createElement('span');
        guessSpan.className = 'pokedex-summary-guess';
        const userGuess = answer?.guess?.trim() ? answer.guess : getTranslation('emptyGuess');
        guessSpan.textContent = `✖ "${userGuess}"`;
        info.appendChild(nameSpan);
        info.appendChild(guessSpan);
        item.appendChild(sprite);
        item.appendChild(info);
        summaryListEl.appendChild(item);
      }
    }
  }
  pokedexInput.disabled = true;
  pokedexSubmitButton.disabled = true;
  summaryOverlay.classList.add('pokedex-summary-visible');
  summaryOverlay.setAttribute('aria-hidden', 'false');
};

const showViewResultsButton = () => {
  pokedexSubmitButton.textContent = getTranslation('viewResults');
  pokedexSubmitButton.disabled = false;
  pokedexInput.style.display = 'none';
};

const hideSummary = () => {
  summaryOverlay.classList.remove('pokedex-summary-visible');
  summaryOverlay.setAttribute('aria-hidden', 'true');
};

const handleQuizSubmit = () => {
  if (isQuizProcessing) return;
  if (quizIndex >= kantoList.length) {
    showSummary();
    return;
  }
  isQuizProcessing = true;
  const pokemon = kantoList[quizIndex];
  const userGuess = pokedexInput.value.trim();
  const correct = isCloseEnough(userGuess, pokemon.name);
  answers[pokemon.id] = { guess: userGuess, correct };
  if (correct) successCount++; else failureCount++;
  updateScoreDisplay({ bumpSuccess: correct, bumpFailure: !correct });
  showFeedback(correct, pokemon.name);
  pokedexInput.disabled = true;
  pokedexSubmitButton.disabled = true;
  saveQuizState();
  window.setTimeout(() => {
    quizIndex++;
    saveQuizState();
    isQuizProcessing = false;
    clearQuizFeedbackEffects();
    renderQuizPokemon();
  }, QUIZ_FEEDBACK_DURATION_MS);
};

const enterQuizMode = () => {
  // Stop any audio that might leak the answer before we hide the name.
  stopPokemonAudio();
  modeTextQuiz.style.display = 'none';
  modeTextNormal.style.display = 'inline';
  pokedexScoreBar.style.display = 'flex';
  pokedexPrevButton.style.display = 'none';
  pokedexNextButton.style.display = 'none';
  pokedexSubmitButton.style.display = 'inline-flex';
  pokedexInput.placeholder = getTranslation('quizPlaceholder');

  if (quizIndex >= kantoList.length && kantoList.length > 0) {
    updateScoreDisplay();
    pokedexImage.style.display = 'none';
    pokedexNumber.textContent = '';
    pokedexName.textContent = '';
    if (pokedexSeparator) pokedexSeparator.textContent = '';
    showViewResultsButton();
  } else {
    renderQuizPokemon();
  }
};

const exitQuizMode = () => {
  modeTextQuiz.style.display = 'inline';
  modeTextNormal.style.display = 'none';
  pokedexScoreBar.style.display = 'none';
  pokedexPrevButton.style.display = 'inline-flex';
  pokedexNextButton.style.display = 'inline-flex';
  pokedexSubmitButton.style.display = 'none';
  pokedexInput.style.display = '';
  pokedexFeedback.style.display = 'none';
  clearQuizFeedbackEffects();
  pokedexInput.placeholder = getTranslation('placeholder');
  renderPokemon(currentPokemonId);
};

if (pokedexModeToggle) {
  pokedexModeToggle.addEventListener('click', () => {
    isQuizMode = !isQuizMode;
    pokedexModeToggle.setAttribute('aria-pressed', String(isQuizMode));
    if (isQuizMode) {
      enterQuizMode();
    } else {
      exitQuizMode();
    }
  });
}

if (pokedexResetButton) {
  pokedexResetButton.addEventListener('click', () => {
    if (!confirm(getTranslation('resetConfirm'))) return;
    hideSummary();
    quizIndex = 0;
    successCount = 0;
    failureCount = 0;
    answers = {};
    try { localStorage.removeItem(QUIZ_STORAGE_KEY); } catch { /* ignore */ }
    isQuizProcessing = false;
    pokedexSubmitButton.textContent = getTranslation('submit');
    pokedexInput.style.display = '';
    clearQuizFeedbackEffects();
    pokedexFeedback.style.display = 'none';
    renderQuizPokemon();
  });
}

if (summaryCloseButton) {
  summaryCloseButton.addEventListener('click', () => {
    hideSummary();
    showViewResultsButton();
  });
}

if (summaryOverlay) {
  summaryOverlay.addEventListener('click', (event) => {
    if (event.target === summaryOverlay) {
      hideSummary();
      showViewResultsButton();
    }
  });
}

if (pokedexSubmitButton) {
  pokedexSubmitButton.addEventListener('click', (event) => {
    event.preventDefault();
    if (quizIndex >= kantoList.length) {
      showSummary();
      return;
    }
    pokedexForm.requestSubmit();
  });
}

initializeApp();

// Service worker registration for PWA install/offline support.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {
      // PWA still works as a regular website if registration fails.
    });
  });
}
