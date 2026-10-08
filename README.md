# link

Open the http(s) link under the cursor in your default browser.

Fork of [pulsar-edit/pulsar](https://github.com/pulsar-edit/pulsar) (`packages/link`).

## Features

- **Open links**: open the http(s) link under the cursor without leaving the editor.
- **Cursor aware**: detects the link at the current cursor position in any editor.
- **Context menu**: opens the link at the right-click position without moving the cursor.
- **Hyperclick**: provides complete link ranges and browser actions to Hyperclick, including named Markdown references.

## Installation

To install `link` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/link`.

## Commands

Commands available in `lumine-text-editor:not([mini])`:

- `link:open`: open the clicked http(s) link from its context menu or the link under the cursor.

## Services

- `hyperclick.provider`: provided to Hyperclick to underline and follow recognized links.
- `background-tips.provider`: provided to show a tip about opening links in the browser.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
