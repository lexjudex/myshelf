// Which version of MyShelf this site runs. The version number comes from package.json; the commit and build
// time are filled in when the site is built (see astro.config.mjs). Shown in Manage → Settings → Updates and
// in /.well-known/myshelf, so friends' sites can tell which features you have.
import pkg from '../package.json' with { type: 'json' };

/* global __MYSHELF_COMMIT__, __MYSHELF_BUILT__ */
export const VERSION = pkg.version;
export const COMMIT = typeof __MYSHELF_COMMIT__ !== 'undefined' ? __MYSHELF_COMMIT__ : '';
export const BUILT = typeof __MYSHELF_BUILT__ !== 'undefined' ? __MYSHELF_BUILT__ : '';

export const versionInfo = () => ({ version: VERSION, commit: COMMIT, built: BUILT });
