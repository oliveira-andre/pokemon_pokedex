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
