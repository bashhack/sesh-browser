# sesh for the browser

The browser extension for [sesh](https://github.com/bashhack/sesh): fill a site's login from your sesh vault, in Chrome and Firefox.

Not ready yet: it's being built. sesh's side, the program the extension talks to (`sesh browser-host`), is in sesh already.

## How it works

The extension never holds your vault. When you ask it to fill a login, from its toolbar button or a keyboard shortcut, it asks sesh, through the browser's native messaging, for the logins of the tab's site. sesh checks the site itself, gives one login's username, password and code, and records the read in its audit log. A locked sesh is unlocked with Touch ID, or from a terminal: your master password never passes through the browser.

## Licence

MIT, as sesh is. Files taken from [browserpass](https://github.com/browserpass/browserpass-extension) keep their ISC notice.
