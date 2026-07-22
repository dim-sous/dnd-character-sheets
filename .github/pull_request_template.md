## What & why

<!-- What this changes and why. Reference the issue it addresses, e.g. "Closes #N". -->

## How to review

<!-- There is no hosted preview. To click through this locally (localhost is its own
     origin, so it can't touch your real characters):
       gh pr checkout <this PR number>
     then Go Live / `python3 -m http.server 8000`. -->

## Checklist

- [ ] Rules suite green — CI runs `node tools/run-tests.mjs`; run it locally too if you touched `js/rules.js`
- [ ] Looked at it on a phone width (~390px)
- [ ] Looked at it on a laptop width (~1440px)
- [ ] Print preview still produces a full sheet (if the layout changed)
- [ ] No new dependency, build step, or runtime library
- [ ] The data layer (`rules.js` / `state.js` / `storage.js` / `constants.js`) is untouched, or the change there is deliberate and covered by a test
