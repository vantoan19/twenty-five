# For You — *The day you arrived*

A little story, told for a 25th birthday. An angel comes down out of a sea of clouds, lands
in a valley garden, makes a meadow bloom, climbs a misty mountain path at sunset, and ends
the day by her birthday cake, making a wish under the stars.

It is a scroll-driven 3D story in the browser, made with three.js. A gentle storyteller's
voice reads it one line at a time. The story only moves forward, and each line holds the
journey back until it has been read, so nothing is missed however fast the page is
scrolled.

## Watch it

Open the site and press **Begin the story**, with sound on. Then scroll, swipe or use the
arrow keys. Scrolling without pressing the button also works, silently, with the words on
screen.

## How it is made

- `src/`: the engine, bundled with esbuild into one script. It covers the world, her, her
  cat and dog, the effects, the camera choreography and the post-processing. The story's
  script and pacing are in `src/story.js`, and the timeline of the journey is in
  `src/timeline.js`.
- `artboard/Main.dc.html`: the page itself, its markup and styles. It is the source of
  the Claude Design canvas this was made in.
- `site/`: the website as deployed, a static folder.
  - `index.html` is built from the artboard.
  - `journey.min.js` is the bundled engine.
  - `voice.js` holds the narration (every line in one recording, with where each begins).

To change and rebuild it:

```sh
npm install
npm run bundle   # src/ -> site/journey.min.js (locked to the hosts in site.config.json)
npm run site     # artboard/Main.dc.html -> site/index.html
npm run serve    # preview site/ locally
```

The website only runs at its own address. The bundle is built for the host names in
`site.config.json` and stays dark anywhere else.

## Credits

- [three.js](https://threejs.org) (MIT).
- The narrator's voice was synthesised offline with
  [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0), blending the
  af_heart and af_nicole voices, slowed and gently aged.
- Type: Newsreader and Hanken Grotesk, from Google Fonts (SIL OFL).

## Copyright

© 2026 vantoan19. All rights reserved. This is a personal gift, shared to be seen, not to be
reused. Please don't copy, modify or re-host it. See [LICENSE](LICENSE).
