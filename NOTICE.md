# Third-party notices

Banana itself is proprietary freeware (see `LICENSE`: free to use, source and redistribution rights reserved). It uses the following third-party components, which remain under their own licences and are **not** covered by the Banana licence. Licence texts ship inside each package in `node_modules/`.

| Component | Version | Licence | Where used |
|---|---|---|---|
| express | 4.x | MIT | backend runtime |
| cors | 2.x | MIT | backend runtime |
| dotenv | 16.x | BSD-2-Clause | backend runtime |
| react, react-dom | 19.x | MIT | frontend bundle |
| antd, @ant-design/icons | 6.x | MIT | frontend bundle |
| (transitive dependencies of the above) | - | MIT, ISC, BSD-3-Clause, Apache-2.0, BlueOak-1.0.0 | see package-lock.json |

Build-time tools (Vite, oxlint, Biome, lightningcss, ...) are used to build the UI and are not part of the shipped runtime. License audit of `node_modules` at the time of writing found only permissive licences (MIT, ISC, BSD, Apache-2.0, BlueOak) plus MPL-2.0 for `lightningcss`, which is a build-time tool and is not distributed.

## KiCad

Banana does **not** include KiCad. It runs the separately installed `kicad-cli` program as an external process. KiCad is licensed under the GNU GPL v3 (with other licences for libraries and assets); see <https://www.kicad.org/about/licensing/>.

If you redistribute KiCad yourself, for example by copying it into `runtime/kicad*/` on a USB stick or by publishing the Docker image built from `kicad/kicad`, **you** are redistributing GPL software and must comply with the GPL for KiCad (including offering its corresponding source). That obligation applies to KiCad only; it does not extend to Banana's own code, which is invoked only as a separate program.

## Node.js

The per-platform downloads include an unmodified official Node.js executable in `runtime/node-<os>-<arch>/` (the same applies if you place one there yourself). Node.js is distributed under its own licence (MIT and bundled third-party licences, see the `LICENSE` file shipped in the Node.js download).
