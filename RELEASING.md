# Releasing Site Scrub

Nothing in this repository publishes anything by itself. Every step below is done by hand.

1. Cut `release/<version>` from `master`.
2. Merge the issue branches into the release branch.
3. Run `npm test` and `npm run test:e2e`. Both must pass.
4. Check the public suffix list. If it is stale, regenerate `psl-data.js`:
   1. Download `https://publicsuffix.org/list/public_suffix_list.dat` by hand to a path outside this repository. The build script makes no network call.
   2. Run `node scripts/build-psl.js <path to the file>`.
   3. Run the tests again.
5. Set `version` to `<version>` in `manifest.json` and in `package.json`.
6. Run `npm run package`. It writes `dist/site-scrub-<version>.zip`. It stops with an error if a file that `manifest.json` or `options.html` names is missing from the zip, or if a shipped file imports a root file that does not ship.
7. Merge the release branch to `master`.
8. Make sure the version file is served, with the header that lets the extension read it:

   ```sh
   curl -sI https://pressware.co/extensions/site-scrub/version.json
   ```

   The status must be `200` and the response must carry an `Access-Control-Allow-Origin` header. Without that header, installed copies never see an update.
9. Tag the merge commit `v<version>`.
10. Create a GitHub release for the tag. Attach the zip.
11. In the pressware.co repository, set `extensions/site-scrub/version.json` to `{"version":"<version>"}`. This file is what makes installed copies show the update banner. Deploy it.
12. Update the Site Scrub pages in the pressware.co repository.

## Chrome Web Store

`manifest.json` has a fixed `key`, so every unpacked install has the same extension id (see `ARCHITECTURE.md`). If a Chrome Web Store listing is made later, the store assigns its own key. Remove the `key` field from the manifest for that build.
