# Pokédex Project

<p align="center">
  <img src="./favicons/pokeball.png" alt="Pokeball" width="120" />
</p>

<p align="center">
  <img src="./images/pokemons/001.gif" alt="Bulbasaur" width="80" />
  <img src="./images/pokemons/004.gif" alt="Charmander" width="80" />
  <img src="./images/pokemons/007.gif" alt="Squirtle" width="80" />
  <img src="./images/pokemons/025.gif" alt="Pikachu" width="96" />
  <img src="./images/pokemons/151.gif" alt="Mew" width="120" />
  <img src="./images/pokemons/150.gif" alt="Mewtwo" width="140" />
</p>

A bilingual Pokédex web app (Brazilian Portuguese + English) with PWA support, local Kanto data, local sprites, and language-aware audio.

### Features
- Full Pokédex layout (left/right on desktop, left only on mobile).
- Language toggle (`Português` / `English`) with live UI text updates.
- Mobile responsiveness for controls, labels, and button behavior.
- PWA support (manifest + service worker + splash experience).
- First-generation sprites (`001..151`) are local in `images/pokemons`.
- `data/kanto-151.json` stores local Pokémon data for Kanto.
- Audio system uses language folders with default fallbacks.
- Quiz Mode ("Who's that Pokémon?") with score tracking, typo tolerance, and a wrong-answers summary.

### Data Source Strategy
- For Pokémon `1..151`:
  - App tries local data first from `data/kanto-151.json`.
  - If local entry is missing/broken, app falls back to [PokéAPI](https://pokeapi.co/).
- For Pokémon `152+`:
  - App uses PokéAPI by default.

### Audio Structure
- Portuguese primary audio folder: `audios/ptbr`
- English primary audio folder: `audios/en`
- Playback fallback order:
1. `audios/{language}/{id}.mp3`
2. `audios/{language}/default-{language}.mp3`
3. `audios/{other-language}/{id}.mp3`
4. `audios/{other-language}/default-{other-language}.mp3`

### Transcripts
- Timestamped transcripts live in `transcripts/ptbr` and `transcripts/en`.
- Transcript files use the same base name as their matching audio file, but with the `.srt` extension.
- Example: `audios/ptbr/default-ptbr.mp3` maps to `transcripts/ptbr/default-ptbr.srt`.
- The app uses these SRT timestamps to sync the right visor captions and the blue light glow during audio playback.

To instal whisper in case you dont have it:
```sh
pip install openai-whisper
```

When intstalled, to generate a transcript with Whisper, run the command from the audio folder or pass the full audio path:

```sh
whisper "default-ptbr.mp3" --language Portuguese --model medium
```

For this project, keep only the generated `.srt` file in the matching `transcripts/{language}` folder.

### Quiz Mode

Quiz Mode is a "Who's that Pokémon?" game built into the same Pokédex shell. Click the `🎮 Quiz Mode` toggle in the controls row to switch in. Toggle again (`Normal Mode`) to return to the regular Pokédex.

#### How it works
- The first 151 Kanto Pokémon are shown in order by their `id`. The sprite is revealed but the name is hidden — only `#001`, `#002`, … is visible.
- Type the Pokémon's name and press `Enter` or click `Submit`.
- Matching is case-insensitive and tolerates a single-character typo (Levenshtein distance ≤ 1), so `pikatchu` still counts as Pikachu but `pickachoo` does not.
- After each answer the panel flashes for `~1.4s` and the next sprite loads automatically. There is no skip button — every entry is graded, including empty submits (counted as wrong).

#### Visual feedback
- The blue audio light at the top-left of the device blinks **green** on a correct answer and **red** on a wrong answer.
- A floating banner pops over the screen showing `✔ Correct!` (green) or `✖ <correct name>` (red).
- The score bar above the device increments either the ✔ or ✖ counter with a small "bump" animation.
- The whole left panel briefly bounces (success) or shakes (failure) using `pokedexFlashSuccess` / `pokedexFlashFailure` keyframes.
- Animations are disabled when the user has `prefers-reduced-motion: reduce` set.

#### Score bar
Sits between the language controls and the device:
```
✔ <correct>    <answered> / 151    ✖ <wrong>    Reset ↺
```
`Reset ↺` clears all progress after a confirm dialog.

#### Persistence
Quiz state is saved to `localStorage` under the key `pokemon-score-state` after every answer. The shape is:
```json
{
  "quizIndex": 12,
  "successCount": 9,
  "failureCount": 3,
  "answers": {
    "1":  { "guess": "bulbasaur",  "correct": true  },
    "7":  { "guess": "squartow",   "correct": false }
  }
}
```
- `quizIndex` is the next un-answered Pokémon (0-based, so `quizIndex === 151` means complete).
- `answers[id].guess` is exactly what the user typed, preserved for the summary screen.

Closing the tab and reopening resumes from the same point. Switching to Normal Mode and back keeps progress intact; only `Reset` clears it.

#### Summary screen
When all 151 are answered, the Submit button becomes `View Results`. Clicking it (or finishing the last answer) opens a modal listing **only the wrong answers**, with the user's exact typed guess in red italics next to each Pokémon — useful for spotting which names you keep mistyping. A perfect run shows a single celebratory line instead of the list.

The modal is dismissable by clicking the close button or the dim overlay; the `View Results` button remains available afterward to reopen it.

#### Bilingual support
The same flag toggles drive the quiz text. Affected strings (in `script.js`'s `translations` object): `quizMode`, `normalMode`, `quizPlaceholder`, `submit`, `viewResults`, `correct`, `quizComplete`, `close`, `resetConfirm`, `perfectRun`, `emptyGuess`. Switching language during a quiz updates labels live without losing progress.

#### Implementation notes
- All quiz logic lives in `script.js` (search for `QUIZ MODE LOGIC`); all quiz styles live in `style.css` after the audio-light keyframes. There are no separate `score.js` / `score.css` files.
- The quiz uses the same `data/kanto-151.json` already shipped for the Pokédex — no extra network calls.
- Pokémon audio is suppressed in Quiz Mode so the cry doesn't spoil the answer.
- The audio-light tint is a class swap (`pokedex-quiz-light-success` / `-failure`) on `.pokedex-left-panel`, reusing the existing `.pokedex-audio-light` element.

### PWA Notes
- App can be installed as a standalone PWA.
- Service worker caches app shell + `kanto-151.json` + local Kanto sprites.
- Splash/loading style uses a blue background and centered Pokéball.

### Run Locally
1. Clone this repository.
2. Serve the project with any static server.
3. Open the app in your browser.

### Open Source

## Contributing

1. Fork this repo and create a branch from `main` (`feat/...` or `fix/...`).
2. Run locally (`python3 -m http.server 8080`) and validate:
   - navigation
   - language toggle
   - audio fallback
   - PWA behavior
   - Quiz Mode (toggle, correct/wrong feedback, reset, summary, language switch mid-quiz)
3. For new audio generation, use ElevenLabs Text to Speech with:
   - Voice: `Little Dude II - Cartoon Character`
   - Model: `Eleven Turbo v2.5`
   - Speed: `0.87`
   - Stability: `70%`
   - Similarity: `70%`
   - Always enable `Language Override` and select `English` or `Portuguese`.
4. Open a focused PR with:
   - clear description
   - screenshots for UI changes
   - no unrelated changes
   - for audio, we have 1-80 in English and 1-117 + 150/151 in Portuguese.

- This project is available as open source under the terms of the [MIT License](https://opensource.org/license/MIT).
