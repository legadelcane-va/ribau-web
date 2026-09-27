# ribau-website

[![Netlify Status](https://api.netlify.com/api/v1/badges/e99be246-cf2e-44e7-8f8b-4f210c9497c1/deploy-status)](https://app.netlify.com/projects/ribau/deploys)

Website to display products from RiBau, the thrift shop of Varese's Dog Shelter.

## Product photos

Put photos in `public/images/products`, named with the product ID from the Google Sheet: `0123.jpg` for a single photo, or `0123_1.jpg`, `0123_2.jpg`, ... for several (`.jpg`, `.jpeg` and `.png` work, with no limit on the number).

`npm run dev` and `npm run build` automatically run `scripts/prepare-images.js` (or run it with `npm run images`). It makes the small WebP thumbnails shown in the product cards (`public/images/thumbs`) and the list of photos of each product (`public/data/images.json`). Both are generated, so they are not committed. Visitors only download a full-size photo when they zoom in.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd) 
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Install node 
```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
```
Open a new terminal or reload bashrc and run
```sh
nvm install 20
```
Should be updated

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Compile and Minify for Production

```sh
npm run build
```
