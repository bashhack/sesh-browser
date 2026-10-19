# sesh for the browser

The browser extension for [sesh](https://github.com/bashhack/sesh): fill a site's login from your sesh vault, in Chrome and Firefox.

Not released yet: it's being built, and is loaded by hand for now. sesh's side, the program the extension talks to (`sesh browser-host`), is in sesh already; `sesh browser install`, which tells the browser where it is, is next.

## Trying it

```bash
npm test          # the extension's own tests
npm run build     # dist/chrome and dist/firefox
```

- **Chrome:** chrome://extensions, turn on Developer mode, Load unpacked, and choose `dist/chrome`. Its ID is always `dgamnkgjechpcflbfflndpegmcbpdajj`: the manifest's `key` fixes it.
- **Firefox:** about:debugging, This Firefox, Load Temporary Add-on, and choose `dist/firefox/manifest.json`. Its ID is `sesh@bashhack.github.io`. A temporary add-on lasts until Firefox restarts; a signed one comes later.

Then open a site you have a login for in sesh, and click the extension's button, or press Alt+Shift+S.

## How it works

The extension never holds your vault. When you ask it to fill a login, from its toolbar button or a keyboard shortcut, it asks sesh, through the browser's native messaging, for the logins of the tab's site. sesh checks the site itself, gives one login's username, password and code, and records the read in its audit log. A locked sesh is unlocked with Touch ID, or from a terminal: your master password never passes through the browser.

## What it may do

It asks for three permissions:
- **activeTab:** it can reach a tab only after you click its button or press its shortcut, and only that tab;
- **scripting:** to put the login into that tab's form;
- **nativeMessaging:** to talk to sesh on your computer.

It asks for no access to sites otherwise, keeps nothing, and sends nothing anywhere but to sesh on your own computer. A login form in an embedded frame from another site isn't filled: the extension can't reach it.

## Licence

MIT, as sesh is. Files taken from [browserpass](https://github.com/browserpass/browserpass-extension) keep their ISC notice.
