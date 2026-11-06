# Pinned public build inputs

These are upstream public artifacts, not user corpus files. They are included so a fresh build does not require a GitHub API token or a reachable GitHub release download. Browser resources are still generated under `public/corpus/` and loaded from the same site.

- `pandoc-3.13-wasm.zip`: unmodified official Pandoc 3.13 WASM release archive, 16,977,768 bytes. SHA-256 `234d2020a7f3a9aab387bd35df3c17ca2ba0078a82490e2b3ede890d648d64fe`. Source: <https://github.com/jgm/pandoc/releases/tag/3.13>. GPL-2.0-or-later; the archive includes COPYING.md and COPYRIGHT. Corresponding source is available from that exact upstream release.
- `rws-empty.sdltm.gz.base64`: gzip/base64 transport encoding of the unmodified public `General En-Fr.sdltm` sample from RWS/trados-studio-api-samples. Decoded size 245,760 bytes, SHA-256 `d0e367a1de5d1ed9f65d9cd031e8d9c551cb5fe4ecb1a5ec948f5a5e2db70eaf`, Git blob `6b429dd22e611042f5cf232f3ec3877c7b088d80`. Source: <https://github.com/RWS/trados-studio-api-samples>. Apache-2.0; see RWS-TEMPLATE-LICENSE. Export clears the sample's attributes and historical metadata in a separate in-memory copy.
- `ORT-LICENSE` and `ORT-ThirdPartyNotices.txt`: unchanged ONNX Runtime notices for commit `89f8206ba4f1c22c39e0297fb55272e8ce8cd7d0`, from <https://github.com/microsoft/onnxruntime/tree/89f8206ba4f1c22c39e0297fb55272e8ce8cd7d0>. These match the pinned Transformers.js runtime dependency.

Model files remain pinned by revision and SHA-256 and are fetched from the configured model source during preparation. No private sample data or credentials belong in this directory.
