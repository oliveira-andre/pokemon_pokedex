// DOM references used across rendering, controls, and PWA splash behavior.
const pokedexName = document.querySelector('.pokedex-name');
const pokedexNumber = document.querySelector('.pokedex-number');
const pokedexImage = document.querySelector('.pokedex-image');
const pokedexForm = document.querySelector('.pokedex-form');
const pokedexInput = document.querySelector('.pokedex-search-input');
const pokedexLeftPanel = document.querySelector('.pokedex-left-panel');
const pokedexPrevButton = document.querySelector('.pokedex-button-prev');
const pokedexNextButton = document.querySelector('.pokedex-button-next');
const pokedexLanguageButtons = document.querySelectorAll('.pokedex-toggle');
const pokedexRightSubtitle = document.querySelector('.pokedex-right-subtitle');
const pokedexTranscriptDisplay = document.querySelector('.pokedex-transcript-display');
const pokedexSplash = document.querySelector('#pokedex-pwa-splash');

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
    documentLanguage: 'en'
  },
  pt: {
    prev: 'Anterior <',
    next: 'Próximo >',
    placeholder: 'Nome ou Número',
    loading: 'Carregando...',
    notFound: 'Não encontrado :c',
    rightSubtitle: 'Navegue pelos botões ou setas do teclado.',
    documentLanguage: 'pt-BR'
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
  pokedexInput.placeholder = getTranslation('placeholder');

  if (pokedexRightSubtitle) {
    pokedexRightSubtitle.textContent = getTranslation('rightSubtitle');
  }

  document.documentElement.lang = getTranslation('documentLanguage');
  document.body.classList.toggle('pokedex-language-pt', currentLanguage === 'pt');

  for (const button of pokedexLanguageButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.language === currentLanguage));
  }

  // Reapply audio language immediately for the currently visible Pokemon.
  if (!isRendering && pokedexNumber.textContent) {
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
  await initializePokemonLimit();
  updateNavigationState();

  await renderPokemon(currentPokemonId);

  if (pokedexSplash) {
    window.setTimeout(() => {
      pokedexSplash.classList.add('pokedex-pwa-splash-hidden');
    }, 180);
  }
};

initializeApp();

// Service worker registration for PWA install/offline support.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {
      // PWA still works as a regular website if registration fails.
    });
  });
}
